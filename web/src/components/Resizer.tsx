import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { cn } from "@/lib/utils"
import { resizing, startResizing, stopResizing } from "@/core/resizing"

export function Resizer({ label, horizontal, onStart, onDrag, onEnd, onCancel, onReset, resetTip = "reset", className, style }: {
  label: string
  /** A horizontal line (between panes above and below): dragged up and down. */
  horizontal?: boolean
  /** A drag begins (to remember where it started), with the pointer's place. */
  onStart?: (clientX: number, clientY: number) => void
  onDrag: (clientX: number, clientY: number) => void
  /** The drag ended (to save the size it left). */
  onEnd?: () => void
  /** Escape: put back the size it had (else it's dragged back to where it started, then ends). */
  onCancel?: () => void
  onReset?: () => void
  resetTip?: string
  className?: string; style?: CSSProperties
}) {
  const unEscape = useRef<(() => void) | null>(null), self = useRef<HTMLDivElement>(null)
  const place = () => {
    const el = self.current, box = el?.offsetParent ?? document.documentElement
    if (!el) return
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    const at = horizontal ? (r.top + r.height / 2 - b.top) / b.height : (r.left + r.width / 2 - b.left) / b.width
    el.setAttribute("aria-valuenow", String(Math.min(100, Math.max(0, Math.round(at * 100 || 0)))))
  }
  useLayoutEffect(place, [])
  const end = () => { unEscape.current?.(); unEscape.current = null; if (!resizing()) return; onEnd?.(); stopResizing(); requestAnimationFrame(place) }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget, id = e.pointerId, x = e.clientX, y = e.clientY
    el.setPointerCapture(id)
    startResizing(horizontal ? "row" : "col")
    onStart?.(x, y)
    const move = (m: globalThis.PointerEvent) => { if (m.pointerId === id) onDrag(m.clientX, m.clientY) }
    const up = (m: globalThis.PointerEvent) => { if (m.pointerId === id) end() }
    const escape = (k: globalThis.KeyboardEvent) => {
      if (k.key !== "Escape") return
      k.preventDefault(); k.stopPropagation()
      if (onCancel) onCancel()
      else onDrag(x, y)
      try { el.releasePointerCapture(id) } catch {}
      end()
    }
    addEventListener("pointermove", move)
    addEventListener("pointerup", up)
    addEventListener("pointercancel", up)
    addEventListener("blur", end)
    addEventListener("keydown", escape, true)
    unEscape.current = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up)
      removeEventListener("blur", end); removeEventListener("keydown", escape, true)
    }
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && onReset) { e.preventDefault(); onReset(); return }
    const step = e.shiftKey ? 48 : 12
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d || (horizontal ? !d[1] : !d[0])) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    onStart?.(x, y); onDrag(x + d[0], y + d[1]); onEnd?.()
    requestAnimationFrame(place)
  }
  return (
    <div ref={self} role="separator" tabIndex={0} aria-orientation={horizontal ? "horizontal" : "vertical"} aria-label={label} onKeyDown={key}
      aria-valuemin={0} aria-valuemax={100} onFocus={place}
      data-tip={onReset ? `Drag to resize, double-click to ${resetTip}` : "Drag to resize"}
      onPointerDown={down} onDoubleClick={onReset} style={style}
      className={cn("group z-10 focus-visible:outline-none", horizontal ? "cursor-row-resize" : "cursor-col-resize", className)}>
      <div className={cn("absolute transition-colors duration-(--motion-fast) group-hover:bg-primary/45 group-hover:delay-100 group-focus-visible:bg-primary/60 group-active:bg-primary/60 group-active:delay-0",
        horizontal ? "inset-x-0 top-1/2 h-[3px] -translate-y-1/2" : "inset-y-0 left-1/2 w-[3px] -translate-x-1/2")} />
    </div>
  )
}
