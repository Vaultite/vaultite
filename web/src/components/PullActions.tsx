// Phones: a page pulled down past its top shows three actions: New note at the left, Commands (the palette) in the
// middle, Close tab at the right. The finger picks one by going left or right, and letting go far enough runs it.
import { useEffect, useRef, useState } from "react"
import { Command, FilePlus, X, type LucideIcon } from "lucide-react"
import { haptic } from "@/core/haptics"
import { cn } from "@/lib/utils"

type Pick = "new" | "commands" | "close"
const ACTIONS: { id: Pick; label: string; icon: LucideIcon }[] = [
  { id: "new", label: "New note", icon: FilePlus },
  { id: "commands", label: "Commands", icon: Command },
  { id: "close", label: "Close tab", icon: X },
]
/** How far down (px) a pull must go to run what's picked; how far sideways picks the left or right one. */
const FAR = 100, SIDE = 48
/** How far the page moves down for a pull of `dy`: after the finger, then less and less. */
const shift = (dy: number) => (dy < 140 ? dy * 0.72 : 100.8 + (dy - 140) * 0.2)
const page = () => document.querySelector<HTMLElement>("#main-scroll > main")
function moveTo(dy: number, ms = 0) {
  const el = page()
  if (!el) return
  el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.2, 0, 0, 1)` : "none"
  el.style.transform = dy ? `translateY(${shift(dy)}px)` : ""
}

/** Where a pull mustn't start: what scrolls or drags on its own, and anything over the page. */
const busy = (t: EventTarget | null) =>
  !!(t as Element | null)?.closest?.("dialog, [data-phone-drawer], [data-phone-bar], .phone-fill, [data-keeps-touch], input, textarea")

export function PullActions({ run }: { run: (what: Pick) => void }) {
  const [pull, setPull] = useState<{ dy: number; pick: Pick } | null>(null)
  const g = useRef<{ x: number; y: number; dy: number; pick: Pick; on: boolean } | null>(null)
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const start = (e: TouchEvent) => {
      g.current = null
      if (e.touches.length !== 1 || scrollY > 0 || busy(e.target) || document.querySelector("dialog[open]")) return
      g.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, pick: "commands", on: false }
    }
    const move = (e: TouchEvent) => {
      const p = g.current
      if (!p) return
      const t = e.touches[0], dy = t.clientY - p.y, dx = t.clientX - p.x
      if (!p.on) {
        // Down first, from the top: a page scrolled since, or going sideways, isn't a pull.
        if (scrollY > 0 || Math.abs(dx) > Math.abs(dy) + 4 || dy < -4) { g.current = null; return }
        if (dy < 12) return
        p.on = true
      }
      const pick: Pick = dx < -SIDE ? "new" : dx > SIDE ? "close" : "commands"
      if ((dy >= FAR) !== (p.dy >= FAR) || (dy >= FAR && pick !== p.pick)) haptic("selection")
      p.dy = Math.max(0, dy)
      p.pick = pick
      moveTo(p.dy)
      setPull({ dy: p.dy, pick })
    }
    const end = () => {
      const p = g.current
      g.current = null
      if (!p?.on) return
      setPull(null)
      moveTo(0, 260)
      if (p.dy >= FAR) { haptic(); runRef.current(p.pick) }
    }
    addEventListener("touchstart", start, { passive: true })
    addEventListener("touchmove", move, { passive: true })
    addEventListener("touchend", end)
    addEventListener("touchcancel", end)
    return () => {
      removeEventListener("touchstart", start); removeEventListener("touchmove", move)
      removeEventListener("touchend", end); removeEventListener("touchcancel", end)
    }
  }, [])
  if (!pull) return null
  const k = Math.min(1, pull.dy / FAR), ready = pull.dy >= FAR
  return (
    <div data-pull-actions aria-hidden className="pointer-events-none fixed inset-x-0 z-20 flex items-center justify-center gap-10 overflow-hidden md:hidden"
      style={{ top: document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0, height: shift(pull.dy), opacity: k }}>
      {ACTIONS.map(({ id, label, icon: Icon }) => {
        const on = ready && pull.pick === id
        return (
          <span key={id} data-pull={id} data-on={on || undefined} className="flex w-16 flex-col items-center gap-1">
            <span className={cn("grid size-11 place-items-center rounded-full transition-[background-color,color,scale] duration-150",
              on ? "scale-110 bg-primary text-primary-foreground" : "bg-foreground/[0.07] text-muted-foreground")}>
              <Icon className="size-[21px]" strokeWidth={2} />
            </span>
            <span className={cn("text-[12px] whitespace-nowrap", on ? "text-foreground" : "text-muted-foreground")}>{label}</span>
          </span>
        )
      })}
    </div>
  )
}
