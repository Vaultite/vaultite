// The one drag-to-resize primitive (sidebar edge, split dividers). While dragging, <body data-resizing> stops size
// animations and keeps the cursor over iframes too. From the keyboard: the arrows drag it a step, Enter resets it.
import type { CSSProperties, KeyboardEvent } from "react"
import { cn } from "@/lib/utils"

export function Resizer({ label, horizontal, onStart, onDrag, onEnd, onReset, resetTip = "reset", className, style }: {
  label: string
  /** A horizontal line (between panes above and below): dragged up and down. */
  horizontal?: boolean
  /** A drag begins (to remember where it started), with the pointer's place. */
  onStart?: (clientX: number, clientY: number) => void
  onDrag: (clientX: number, clientY: number) => void
  /** The drag ended (to save the size it left). */
  onEnd?: () => void
  onReset?: () => void
  resetTip?: string
  className?: string; style?: CSSProperties
}) {
  const end = () => { if (!("resizing" in document.body.dataset)) return; delete document.body.dataset.resizing; onEnd?.() }
  // A key is a whole drag, from the line's middle to a step along.
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && onReset) { e.preventDefault(); onReset(); return }
    const step = e.shiftKey ? 48 : 12
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d || (horizontal ? !d[1] : !d[0])) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    onStart?.(x, y); onDrag(x + d[0], y + d[1]); onEnd?.()
  }
  return (
    <div role="separator" tabIndex={0} aria-orientation={horizontal ? "horizontal" : "vertical"} aria-label={label} onKeyDown={key}
      data-tip={onReset ? `Drag to resize, double-click to ${resetTip}` : "Drag to resize"}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); document.body.dataset.resizing = horizontal ? "row" : "col"; onStart?.(e.clientX, e.clientY) }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.clientX, e.clientY) }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onDoubleClick={onReset} style={style}
      className={cn("group z-10 focus-visible:outline-none", horizontal ? "cursor-row-resize" : "cursor-col-resize", className)}>
      <div className="absolute inset-0 transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary/60 group-active:bg-primary/60" />
    </div>
  )
}
