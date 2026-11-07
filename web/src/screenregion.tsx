// The user's box over the screen (electron/capture.ts): a drag with the Talk key held makes it. Its edges move it, its
// corners resize it, the pointer goes through inside; its pill records, stops, sends the last seconds, closes.
import { useEffect, useRef, useState } from "react"
import { History, X } from "lucide-react"
import { clock, type Rect, type RegionScene } from "../../plugins/core/companion/clips"

type Edge = "move" | "nw" | "ne" | "sw" | "se"
const BAND = 8, LEAST = 24

/** `rect` dragged by `edge` from where it was (`r0`) by dx, dy, kept at least LEAST a side. */
function dragged(r0: Rect, edge: Edge, dx: number, dy: number): Rect {
  if (edge === "move") return { ...r0, x: r0.x + dx, y: r0.y + dy }
  const left = edge === "nw" || edge === "sw", top = edge === "nw" || edge === "ne"
  const x = left ? Math.min(r0.x + dx, r0.x + r0.width - LEAST) : r0.x, y = top ? Math.min(r0.y + dy, r0.y + r0.height - LEAST) : r0.y
  const width = left ? r0.x + r0.width - x : Math.max(LEAST, r0.width + dx), height = top ? r0.y + r0.height - y : Math.max(LEAST, r0.height + dy)
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export function Region({ r, top, grab, moved, act }: { r: RegionScene; top: number; grab: (on: boolean) => void; moved: (rect: Rect) => void; act: (what: string) => void }) {
  const [held, setHeld] = useState<Rect | null>(null)
  const drag = useRef<{ edge: Edge; x: number; y: number; r0: Rect } | null>(null)
  const over = useRef(0)
  const [, tick] = useState(0)
  useEffect(() => { if (!r.recording) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [r.recording])
  // (the window takes the pointer over the edges and the pill, and through a drag that leaves them)
  const enter = () => { if (over.current++ === 0 && !drag.current) grab(true) }
  const leave = () => { if (--over.current === 0 && !drag.current) grab(false) }
  useEffect(() => () => { if (over.current || drag.current) grab(false) }, [])
  const rect = held ?? r.rect, tint = r.recording ? "var(--red)" : `var(--${r.tint})`
  const down = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { edge, x: e.clientX, y: e.clientY, r0: rect }
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
    if (!over.current) grab(false)
  }
  const handlers = (edge: Edge) => ({ onPointerDown: down(edge), onPointerMove: move, onPointerUp: up, onPointerCancel: up, onPointerEnter: enter, onPointerLeave: leave })
  const band = (style: React.CSSProperties) => <div className="pointer-events-auto absolute cursor-move" style={style} {...handlers("move")} />
  const corner = (edge: Exclude<Edge, "move">, style: React.CSSProperties) =>
    <div className="pointer-events-auto absolute size-3 rounded-[3px] border-2 bg-white" style={{ borderColor: tint, cursor: edge === "nw" || edge === "se" ? "nwse-resize" : "nesw-resize", ...style }} {...handlers(edge)} />
  // (the pill above the box, inside it when the menu bar is in the way)
  const pillAbove = rect.y - top >= 34
  return (
    <div className="screen-in pointer-events-none fixed" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} data-region={r.recording ? "recording" : "idle"}>
      <div className={r.recording ? "absolute inset-0 rounded-[3px] border-2 region-rec" : "absolute inset-0 rounded-[3px] border-2 border-dashed"} style={{ borderColor: tint, boxShadow: "0 0 0 1px rgba(255,255,255,.55)" }} />
      {band({ left: -BAND / 2, right: -BAND / 2, top: -BAND / 2, height: BAND })}
      {band({ left: -BAND / 2, right: -BAND / 2, bottom: -BAND / 2, height: BAND })}
      {band({ top: -BAND / 2, bottom: -BAND / 2, left: -BAND / 2, width: BAND })}
      {band({ top: -BAND / 2, bottom: -BAND / 2, right: -BAND / 2, width: BAND })}
      {!r.recording && <>
        {corner("nw", { left: -6, top: -6 })}{corner("ne", { right: -6, top: -6 })}{corner("sw", { left: -6, bottom: -6 })}{corner("se", { right: -6, bottom: -6 })}
      </>}
      <div className="pointer-events-auto absolute left-0 flex items-center gap-0.5 rounded-full border border-black/10 bg-background/95 p-0.5 text-[12px] font-medium shadow-md backdrop-blur"
        style={pillAbove ? { bottom: "calc(100% + 8px)" } : { top: 8, left: 8 }} onPointerEnter={enter} onPointerLeave={leave}>
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
      </div>
    </div>
  )
}

export const REGION_STYLE = `
.region-rec { animation: region-rec 1.6s ease-in-out infinite; }
@keyframes region-rec { 50% { opacity: .55; } }
.region-dot { animation: region-rec 1s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .region-rec, .region-dot { animation: none !important; } }
`
