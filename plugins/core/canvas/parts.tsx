import { useEffect, useRef, type MouseEvent } from "react"
import type { StickyNote } from "lucide-react"
import { cn } from "@vaultite"

export function Tool({ icon: Icon, label, keys = "", onClick, disabled, swatch }: { icon: typeof StickyNote; label: string; keys?: string; onClick: (e: MouseEvent) => void; disabled?: boolean; swatch?: string | null }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} data-tip={label + keys} data-canvas-tool={label}
      className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent max-md:size-10">
      <Icon className="size-4" strokeWidth={2.25} />
      {swatch && <span className="absolute right-1 bottom-1 size-2 rounded-full" style={{ background: swatch }} />}
    </button>
  )
}

export function LabelEditor({ value, className, onDone }: { value: string; className: string; onDone: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus({ preventScroll: true }); ref.current?.select() }, [])
  const finish = () => { if (done.current) return; done.current = true; onDone(ref.current!.value.trim()) }
  return (
    <input ref={ref} defaultValue={value} onBlur={finish} className={cn("outline-none", className)} data-canvas-label-editor
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); finish() } }}
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} />
  )
}
