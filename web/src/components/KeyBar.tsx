// Phones: a row of keys above the on-screen keyboard (the terminal's esc and arrows, a note's undo and bold), and the
// part of the window the keyboard leaves visible.
import { useLayoutEffect, useState, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from "react"
import { KeyboardOff } from "lucide-react"
import { cn } from "@/lib/utils"

/** The on-screen keyboard is up: the visible part of the page is well short of the window. */
export const keyboardUp = () => !!visualViewport && innerHeight - visualViewport.height > 80

/** The part of the window the user sees (above the on-screen keyboard), followed while `on`. */
export function useVisibleArea(on: boolean) {
  const [area, setArea] = useState<{ top: number; height: number; keyboard: boolean } | null>(null)
  useLayoutEffect(() => {
    const vv = visualViewport
    if (!on || !vv) return setArea(null)
    const read = () => setArea({ top: vv.offsetTop, height: vv.height, keyboard: keyboardUp() })
    read()
    vv.addEventListener("resize", read)
    vv.addEventListener("scroll", read)
    return () => { vv.removeEventListener("resize", read); vv.removeEventListener("scroll", read) }
  }, [on])
  return area
}

export type BarKey = { name: string; label: ReactNode; run: () => void }

/** The row above the keyboard, Hide keyboard at its end. Its buttons never take focus (press and touch end cancelled,
 *  nothing selectable), since on iOS that moves focus off the text and the keyboard goes; they act as the finger lifts.
 *  `scroll`: keys a finger's width each, the row scrolling sideways when they don't fit (else they share it). */
export function KeyBar({ label, keys, hide, scroll, className }: { label: string; keys: BarKey[]; hide: () => void; scroll?: boolean; className?: string }) {
  const key = cn("grid h-9 cursor-pointer place-items-center rounded-[8px] bg-card font-mono text-[13px] text-foreground active:bg-foreground/[0.12]",
    scroll ? "min-w-11 shrink-0 flex-1 px-1" : "min-w-0 flex-1")
  const tap = (run: () => void) => ({
    onPointerDown: (e: PointerEvent) => e.preventDefault(),
    onMouseDown: (e: ReactMouseEvent) => e.preventDefault(),
    onTouchEnd: (e: ReactTouchEvent) => { if (e.cancelable) e.preventDefault() },
    onPointerUp: (e: PointerEvent) => { if (e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY))) run() },
  })
  return (
    <div role="toolbar" aria-label={label} data-no-drag data-key-bar
      className={cn("flex shrink-0 items-center gap-1 border-t-[0.5px] border-border bg-sidebar py-1.5 pr-1.5 select-none [-webkit-touch-callout:none]", className)}>
      <div className={cn("flex min-w-0 flex-1 gap-1 pl-1.5", scroll && "overflow-x-auto overscroll-x-contain [scrollbar-width:none]")}>
        {keys.map((k) => (
          <button key={k.name} type="button" tabIndex={-1} aria-label={k.name} {...tap(k.run)} className={key}>{k.label}</button>
        ))}
      </div>
      <button type="button" tabIndex={-1} aria-label="Hide keyboard" {...tap(hide)}
        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[8px] text-muted-foreground active:bg-foreground/[0.12]">
        <KeyboardOff className="size-[19px]" strokeWidth={1.9} />
      </button>
    </div>
  )
}
