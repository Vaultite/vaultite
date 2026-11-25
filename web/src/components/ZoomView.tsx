import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { Maximize, Minus, Plus, type LucideIcon } from "lucide-react"
import { moves } from "@/core/animation"
import { useCommandKeys } from "@/core/commands"
import { PanZoom, type Drawn, type PanZoomOptions } from "@/core/panzoomer"
import type { Size } from "@/core/panzoom"
import { addViewer } from "@/core/viewers"
import { useZoomTarget } from "@/core/zoom"
import { cn } from "@/lib/utils"

function usePanZoom(box: RefObject<HTMLElement | null>, o: Omit<PanZoomOptions, "moves">, keys = true) {
  const live = useRef(o), zoom = useRef<PanZoom | null>(null)
  useLayoutEffect(() => { live.current = o })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const z = new PanZoom(el, {
      size: () => live.current.size(), paint: (v) => {
        el.toggleAttribute("data-zoomed", !v.fitted)
        live.current.paint(v)
      }, pad: o.pad, grows: () => !!live.current.grows?.(), clicks: () => !!live.current.clicks?.(), taps: o.taps, moves,
    })
    zoom.current = z
    const off = addViewer({ box: el, zoom: z })
    return () => { off(); z.destroy(); zoom.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one for the box's life; the options are read live
  }, [])
  useZoomTarget(box, (step) => { if (step) zoom.current?.step(step); else zoom.current?.zoomTo(1); return null }, { fit: () => zoom.current?.fit(), keyboardIn: !keys })
  return zoom
}

export function ZoomView({ size, vector, label, tools = true, clicks = true, focus, pad = 12, className, children }: {
  size: Size | null
  vector?: boolean
  label: string
  tools?: boolean
  clicks?: boolean
  focus?: boolean
  pad?: number
  className?: string
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), percent = useRef<HTMLSpanElement>(null)
  const paint = ({ k, x, y }: Drawn) => {
    const el = stage.current, dots = devicePixelRatio || 1, whole = (n: number) => Math.round(n * dots) / dots
    if (!el || !size) return
    Object.assign(el.style, { width: `${size.w * k}px`, height: `${size.h * k}px`, transform: `translate(${whole(x)}px, ${whole(y)}px)` })
    if (percent.current) percent.current.textContent = `${Math.round(k * 100)}%`
  }
  const zoom = usePanZoom(box, { size: () => size, paint, pad, taps: true, grows: () => !!vector, clicks: () => clicks })
  useLayoutEffect(() => { zoom.current?.refresh() }, [zoom, size?.w, size?.h, vector])
  useEffect(() => { if (focus) box.current?.focus({ preventScroll: true }) }, [focus])
  return (
    <div ref={box} tabIndex={0} role="group" aria-label={`Viewer: ${label}`} data-zoom-view data-clicks={clicks || undefined}
      className={cn("group/zoom relative isolate size-full overflow-clip outline-none select-none", !focus && "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset", className)}>
      <div ref={stage} className={cn("absolute top-0 left-0", !size && "invisible")}>{children}</div>
      {tools && <ZoomTools zoom={zoom} percent={percent} />}
    </div>
  )
}

export function ZoomInPlace({ onZoomed, keys, className, children }: { onZoomed?: (on: boolean) => void; keys?: boolean; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), percent = useRef<HTMLSpanElement>(null), was = useRef(false)
  const size = () => { const el = box.current; return el && el.clientWidth && el.clientHeight ? { w: el.clientWidth, h: el.clientHeight } : null }
  const paint = ({ k, x, y, fitted }: Drawn) => {
    const el = stage.current
    if (!el) return
    el.style.transform = fitted ? "" : `translate(${x}px, ${y}px) scale(${k})`
    if (percent.current) percent.current.textContent = `${Math.round(k * 100)}%`
    if (was.current === fitted) { was.current = !fitted; onZoomed?.(!fitted) }
  }
  const zoom = usePanZoom(box, { size, paint }, keys)
  return (
    <div ref={box} data-zoom-view className={cn("group/zoom relative overflow-clip", className)}>
      <div ref={stage} className="size-full origin-top-left">{children}</div>
      <ZoomTools zoom={zoom} percent={percent} zoomedOnly />
    </div>
  )
}

function ZoomTools({ zoom, percent, zoomedOnly }: { zoom: RefObject<PanZoom | null>; percent: RefObject<HTMLSpanElement | null>; zoomedOnly?: boolean }) {
  const inKeys = useCommandKeys("viewer:zoom-in", true), outKeys = useCommandKeys("viewer:zoom-out", true)
  const fitKeys = useCommandKeys("viewer:fit", true), actualKeys = useCommandKeys("viewer:actual", true)
  return (
    <div data-zoom-tools className={cn("glass absolute top-3 right-3 z-[1] flex flex-col items-center gap-0.5 rounded-[12px] p-1 max-md:top-2 max-md:right-2",
      "pointer-events-none opacity-0 transition-opacity duration-(--motion-fast) group-data-zoomed/zoom:pointer-events-auto group-data-zoomed/zoom:opacity-100",
      !zoomedOnly && "focus-within:pointer-events-auto focus-within:opacity-100 group-hover/zoom:pointer-events-auto group-hover/zoom:opacity-100")}>
      <ZoomTool icon={Plus} label="Zoom in" tip={inKeys} pinched run={() => zoom.current?.step(1)} />
      <button type="button" onClick={() => zoom.current?.zoomTo(1)} data-tip={`Zoom to 100%${actualKeys}`} data-zoom-tool="Zoom to 100%"
        className="h-6 w-9 cursor-pointer rounded-[6px] text-[11px] font-medium text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground max-md:h-8 max-md:w-10">
        <span ref={percent}>100%</span>
      </button>
      <ZoomTool icon={Minus} label="Zoom out" tip={outKeys} pinched run={() => zoom.current?.step(-1)} />
      <ZoomTool icon={Maximize} label="Zoom to fit" tip={fitKeys} run={() => zoom.current?.fit()} />
    </div>
  )
}

function ZoomTool({ icon: Icon, label, tip, pinched, run }: { icon: LucideIcon; label: string; tip: string; pinched?: boolean; run: () => void }) {
  return (
    <button type="button" onClick={run} aria-label={label} data-tip={label + tip} data-zoom-tool={label}
      className={cn("grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-11", pinched && "pointer-coarse:hidden")}>
      <Icon className="size-4" strokeWidth={2.25} />
    </button>
  )
}

export function ZoomImage({ src, vector, label, size, onSize, onError, ...view }: {
  src: string; vector?: boolean; label: string; size: Size | null; onSize: (s: Size) => void; onError?: () => void
  tools?: boolean; clicks?: boolean; focus?: boolean; pad?: number; className?: string
}) {
  return (
    <ZoomView size={size} vector={vector} label={label} {...view}>
      <img src={src} alt={label} draggable={false} className="block size-full max-w-none" onError={onError}
        onLoad={({ currentTarget: i }) => onSize({ w: i.naturalWidth || 300, h: i.naturalHeight || 150 })} />
    </ZoomView>
  )
}
