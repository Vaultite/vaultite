import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Command as CommandIcon } from "lucide-react"
import { available, runCommandById, useCommandList, type Command } from "@/core/commands"
import { fingerHolding } from "@/core/drag"
import { haptic } from "@/core/haptics"
import { moves } from "@/core/animation"
import { commandIcon } from "@/core/pages"
import { usePrefs, type Prefs } from "@/core/prefs"
import { cn } from "@/lib/utils"
import { closestOf } from "@/core/dom"

export type Slot = 0 | 1 | 2
export const PULL_SLOTS = ["Pull down and left", "Pull straight down", "Pull down and right"] as const
export const DEFAULT_PULL = ["file:new", "switcher:open", "tab:close"]
export const pullActions = (p: Pick<Prefs, "pullActions">) => DEFAULT_PULL.map((d, i) => p.pullActions?.[i] || d)
export const pullLabel = (c: Command) => c.label ?? c.name
const SHOW = 40, SIDES = 72, SHOWN = 104, FAR = 150, SIDE = 48
const HELD = 90
const SETTLE = 250
const GAP = 100, GAP_FROM = 52
const BAND = 200
const shift = (dy: number) => BAND * (1 - Math.exp(-Math.max(0, dy) / BAND))
const along = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)))
const EASE = "cubic-bezier(.2, 0, 0, 1)"
const page = () => document.querySelector<HTMLElement>("#main-scroll > main")
function moveTo(dy: number, ms = 0) {
  const el = page()
  if (!el) return
  el.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none"
  el.style.transform = dy ? `translateY(${shift(dy)}px)` : ""
}

const busy = (t: EventTarget | null) =>
  !!closestOf(t, "dialog, [data-phone-drawer], [data-phone-bar], .phone-fill, [data-keeps-touch], input, textarea")

function scrollerUnder(t: EventTarget | null) {
  for (let el = t instanceof HTMLElement ? t : null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollHeight <= el.clientHeight + 1) continue
    const o = getComputedStyle(el).overflowY
    if (o === "auto" || o === "scroll") return el
  }
  return null
}
const scrolledBy = (sc: HTMLElement | null) => (sc ? sc.scrollTop : scrollY)

type Pull = { dy: number; pick: Slot; ready: boolean; gone?: "ran" | "let" }

type Finger = { x: number; y: number; last: number; dy: number; pick: Slot; on: boolean; ready: number; armed: boolean; sc: HTMLElement | null }

function pulling(p: Finger, t: Touch): boolean | "no" {
  const down = t.clientY >= p.last
  p.last = t.clientY
  if (!p.armed) {
    if (scrolledBy(p.sc) <= 0 && down) { p.armed = true; p.x = t.clientX; p.y = t.clientY }
    return false
  }
  if (p.on) return true
  const dy = t.clientY - p.y
  if (scrolledBy(p.sc) > 0 || Math.abs(t.clientX - p.x) > Math.abs(dy) + 4 || dy < -4) return "no"
  return (p.on = dy >= 12)
}

function watchPulls(show: (p: Pull) => void, slots: () => (Command | null)[]) {
  let g: Finger | null = null, scrolled = -Infinity, was = scrollY
  const scroll = (e: Event) => { if (was > 0 || scrollY > 0) scrolled = e.timeStamp; was = scrollY }
  const start = (e: TouchEvent) => {
    g = null
    if (e.touches.length !== 1 || busy(e.target) || document.querySelector("dialog[open]")) return
    const t = e.touches[0], sc = scrollerUnder(e.target)
    g = { x: t.clientX, y: t.clientY, last: t.clientY, dy: 0, pick: 1, on: false, ready: 0, armed: scrolledBy(sc) <= 0 && e.timeStamp - scrolled >= SETTLE, sc }
  }
  const move = (e: TouchEvent) => {
    const p = g
    if (!p) return
    if (fingerHolding()) { g = null; return }
    const t = e.touches[0], on = pulling(p, t)
    if (on === "no") { g = null; return }
    if (!on) return
    const dy = Math.max(0, t.clientY - p.y), dx = t.clientX - p.x
    const pick: Slot = dx < -SIDE ? 0 : dx > SIDE ? 2 : 1
    const ready = dy >= FAR, wasReady = p.dy >= FAR
    if (ready !== wasReady || (ready && pick !== p.pick)) haptic("selection")
    if (ready && (!wasReady || pick !== p.pick)) p.ready = e.timeStamp
    p.dy = dy
    p.pick = pick
    show({ dy, pick, ready })
    moveTo(dy)
  }
  const end = (e: TouchEvent) => {
    const p = g
    g = null
    if (!p?.on) return
    moveTo(0, 280)
    const c = slots()[p.pick], ran = p.dy >= FAR && !!c && e.timeStamp - p.ready >= HELD
    show({ dy: p.dy, pick: p.pick, ready: p.dy >= FAR, gone: ran ? "ran" : "let" })
    if (ran) { haptic(); runCommandById(c.id) }
  }
  addEventListener("scroll", scroll, { passive: true })
  addEventListener("touchstart", start, { passive: true })
  addEventListener("touchmove", move, { passive: true })
  addEventListener("touchend", end)
  addEventListener("touchcancel", end)
  return () => {
    removeEventListener("scroll", scroll)
    removeEventListener("touchstart", start); removeEventListener("touchmove", move)
    removeEventListener("touchend", end); removeEventListener("touchcancel", end)
  }
}

export function PullActions() {
  const prefs = usePrefs()
  const byId = new Map(useCommandList().map((c) => [c.id, c]))
  const slots = pullActions(prefs).map((id) => { const c = byId.get(id); return c && available([c]).length ? c : null })
  const [pull, setPull] = useState<Pull | null>(null)
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const box = useRef<HTMLDivElement>(null), disc = useRef<HTMLSpanElement>(null)
  useEffect(() => watchPulls((p) => flushSync(() => setPull(p?.gone && !moves() ? null : p)), () => slotsRef.current), [])
  const gone = pull?.gone
  useLayoutEffect(() => {
    const el = box.current
    if (!gone || !el) return
    const fold = el.animate([{ height: el.style.height, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 280, easing: EASE, fill: "forwards" })
    if (gone === "ran") disc.current?.animate([{ scale: 1, opacity: 1 }, { scale: 1.8, opacity: 0 }], { duration: 280, easing: "cubic-bezier(.3, 0, .2, 1)", fill: "forwards" })
    fold.onfinish = () => setPull((p) => (p?.gone ? null : p))
    return () => { fold.onfinish = null; for (const a of el.getAnimations({ subtree: true })) a.cancel() }
  }, [gone])
  if (!pull) return null
  const { dy, pick, ready } = pull
  const ring = along(dy, SHOWN, FAR)
  const at = (i: number) => (i - 1) * (GAP_FROM + (GAP - GAP_FROM) * along(dy, SIDES, SHOWN))
  return (
    <div ref={box} data-pull-actions aria-hidden className="pointer-events-none fixed inset-x-0 z-20 overflow-hidden md:hidden"
      style={{ top: document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0, height: shift(dy) }}>
      <div className="absolute inset-x-0 top-1/2">
        <span ref={disc} className={cn("absolute top-0 left-1/2 -mt-[22px] -ml-[22px] size-11 rounded-full bg-primary transition-[translate,scale,opacity]",
          ready ? "scale-100 opacity-100 duration-(--motion) ease-[cubic-bezier(.3,1.4,.6,1)]" : "scale-50 opacity-0 duration-(--motion-fast)")}
          style={{ translate: `${at(pick)}px 0` }} />
        {slots.map((c, i) => {
          if (!c) return null
          const picked = pick === i, on = ready && picked, Icon = commandIcon(c) ?? CommandIcon
          const seen = i === 1 ? along(dy, SHOW, SIDES) : along(dy, SIDES, SHOWN)
          return (
            <span key={i} data-pull={c.id} data-on={on || undefined} className="absolute top-0 left-1/2" style={{ translate: `${at(i)}px 0` }}>
              <span className={cn("absolute -top-[22px] -left-[22px] grid size-11 place-items-center rounded-full transition-colors duration-(--motion-fast)",
                on ? "text-primary-foreground" : "bg-foreground/[0.07] text-muted-foreground")}
                style={{ opacity: seen, scale: String(0.6 + 0.4 * seen) }}>
                {picked && !ready && ring > 0 && <Ring k={ring} />}
                <Icon className="size-[21px]" strokeWidth={2} />
              </span>
              <span className={cn("absolute top-[28px] left-0 w-max max-w-[112px] -translate-x-1/2 truncate text-[13px] leading-[16px] font-medium text-foreground transition-opacity",
                on ? "opacity-100 duration-(--motion-fast)" : "opacity-0 duration-100")}>{pullLabel(c)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Ring({ k }: { k: number }) {
  const r = 20.5, c = 2 * Math.PI * r
  return (
    <svg data-pull-ring viewBox="0 0 44 44" className="pointer-events-none absolute inset-0 size-11 -rotate-90 text-primary">
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - k)} />
    </svg>
  )
}
