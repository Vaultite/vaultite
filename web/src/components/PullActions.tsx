// Phones: a page pulled down past its top shows three commands (appearance.json's `pullActions`: New note, Open a file,
// Close tab). Going left or right picks one; a ring round it fills as the pull goes, and a let-go once it's full runs it.
import { useEffect, useRef, useState } from "react"
import { Command as CommandIcon } from "lucide-react"
import { available, runCommandById, useCommandList, type Command } from "@/core/commands"
import { haptic } from "@/core/haptics"
import { commandIcon } from "@/core/pages"
import { usePrefs, type Prefs } from "@/core/prefs"
import { cn } from "@/lib/utils"

/** Where the finger went: left, straight down (the one a plain pull runs) or right. */
export type Slot = 0 | 1 | 2
export const PULL_SLOTS = ["Pull down and left", "Pull straight down", "Pull down and right"] as const
export const DEFAULT_PULL = ["file:new", "switcher:open", "tab:close"]
/** The three commands' ids, left to right (a slot a saved list leaves out keeps its default). */
export const pullActions = (p: Pick<Prefs, "pullActions">) => DEFAULT_PULL.map((d, i) => p.pullActions?.[i] || d)
export const pullLabel = (c: Command) => c.label ?? c.name
/** How far down (px) a pull must go to run what's picked; how far sideways picks the left or right one. */
const FAR = 150, SIDE = 48
/** How long (ms) the ring must have been full at the let-go: a flick through it is no pull. */
const HELD = 90
/** How far the page moves down for a pull of `dy`: behind the finger, then less and less. */
const shift = (dy: number) => (dy < FAR ? dy * 0.58 : FAR * 0.58 + (dy - FAR) * 0.15)
/** How full the ring is (0 to 1) at a pull of `dy`. */
const fill = (dy: number) => Math.min(1, Math.max(0, (dy - 24) / (FAR - 24)))
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

export function PullActions() {
  const prefs = usePrefs()
  const byId = new Map(useCommandList().map((c) => [c.id, c]))
  // One not there now (its plugin off, or only on computers) leaves its place empty, so the others stay where the finger expects.
  const slots = pullActions(prefs).map((id) => { const c = byId.get(id); return c && available([c]).length ? c : null })
  const [pull, setPull] = useState<{ dy: number; pick: Slot } | null>(null)
  const g = useRef<{ x: number; y: number; dy: number; pick: Slot; on: boolean; full: number } | null>(null)
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  useEffect(() => {
    const start = (e: TouchEvent) => {
      g.current = null
      if (e.touches.length !== 1 || scrollY > 0 || busy(e.target) || document.querySelector("dialog[open]")) return
      g.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dy: 0, pick: 1, on: false, full: 0 }
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
      const pick: Slot = dx < -SIDE ? 0 : dx > SIDE ? 2 : 1
      if ((dy >= FAR) !== (p.dy >= FAR) || (dy >= FAR && pick !== p.pick)) haptic("selection")
      if (dy >= FAR && (p.dy < FAR || pick !== p.pick)) p.full = e.timeStamp
      p.dy = Math.max(0, dy)
      p.pick = pick
      moveTo(p.dy)
      setPull({ dy: p.dy, pick })
    }
    const end = (e: TouchEvent) => {
      const p = g.current
      g.current = null
      if (!p?.on) return
      setPull(null)
      moveTo(0, 260)
      const c = slotsRef.current[p.pick]
      if (p.dy >= FAR && c && e.timeStamp - p.full >= HELD) { haptic(); runCommandById(c.id) }
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
  const k = Math.min(1, pull.dy / 60), ready = pull.dy >= FAR, ring = fill(pull.dy)
  return (
    <div data-pull-actions aria-hidden className="pointer-events-none fixed inset-x-0 z-20 flex items-center justify-center gap-6 overflow-hidden md:hidden"
      style={{ top: document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0, height: shift(pull.dy), opacity: k }}>
      {slots.map((c, i) => {
        if (!c) return <span key={i} className="w-[72px]" />
        const picked = pull.pick === i, on = ready && picked, Icon = commandIcon(c) ?? CommandIcon
        return (
          <span key={i} data-pull={c.id} data-on={on || undefined} className="flex w-[72px] flex-col items-center gap-1">
            <span className={cn("relative grid size-11 place-items-center rounded-full transition-[background-color,color,scale] duration-150",
              on ? "scale-110 bg-primary text-primary-foreground" : "bg-foreground/[0.07] text-muted-foreground")}>
              {picked && !on && <Ring k={ring} />}
              <Icon className="size-[21px]" strokeWidth={2} />
            </span>
            <span className={cn("line-clamp-2 text-center text-[12px] leading-[15px]", on ? "text-foreground" : "text-muted-foreground")}>{pullLabel(c)}</span>
          </span>
        )
      })}
    </div>
  )
}

/** The picked one's ring, `k` of the way round from the top. */
function Ring({ k }: { k: number }) {
  const r = 20.5, c = 2 * Math.PI * r
  return (
    <svg data-pull-ring viewBox="0 0 44 44" className="pointer-events-none absolute inset-0 size-11 -rotate-90 text-primary">
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - k)} opacity={k ? 1 : 0} />
    </svg>
  )
}
