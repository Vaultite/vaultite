// Swipe a row sideways to show its actions behind it, like Mail's: away from its drawer, so the drawer's own swipe
// still closes it. Vertical swipes, mice and holds are left to others.
import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { selecting } from "@/core/select"
import { cn } from "@/lib/utils"

/** `removes`: it takes the row away (Done, Delete): the row goes at once, like Mail's, and comes back if `run` fails
 *  (rejects) or the row is still there once it's done. */
export type SwipeAction = { label: string; icon: LucideIcon; run: () => unknown; danger?: boolean; removes?: boolean }

/** How wide each button is (px). */
const BUTTON = 74
/** The row that's open, by how to close it. */
let shut: (() => void) | null = null

/** `actions`: asked for when a swipe starts (none: the row doesn't swipe), so rows that are never swiped make no buttons.
 *  `under` instead: buttons drawn as they are (a heading's, which a mouse finds on hover), uncovered by the swipe. */
export function SwipeRow({ actions, under: behind, children, className, ...rest }: {
  actions?: () => SwipeAction[]; under?: ReactNode; children: ReactNode; className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">) {
  const row = useRef<HTMLDivElement>(null), under = useRef<HTMLDivElement>(null), own = useRef<HTMLSpanElement>(null)
  const g = useRef<{ x: number; y: number; from: number; axis: "x" | "y" | "pass" | null; full: boolean; room: number; quit?: () => void } | null>(null)
  const at = useRef(0)
  /** 1: the row slides right (its buttons on the left), -1: left. */
  const way = useRef<1 | -1>(-1)
  /** A swipe just ended (or a tap closed it): the click it makes opens nothing. */
  const swiped = useRef(false)
  /** The buttons, from the swipe's start until it's closed again; on a short row (a drawer's) icons only. */
  const [shown, setShown] = useState<SwipeAction[]>([])
  const [short, setShort] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Stable (refs only): `shut` knows the open row by its close, which a redraw while open mustn't change, or a press on
  // its own button closes it first (and iOS drops a click whose press changed the page).
  const place = useCallback((x: number, animate = false) => {
    at.current = x
    const r = row.current, u = under.current
    if (!r || !u) return
    const t = animate ? "220ms cubic-bezier(.2,.8,.2,1)" : ""
    r.style.transition = t && `transform ${t}`
    r.style.transform = x ? `translateX(${x}px)` : ""
    u.style.transition = t && `width ${t}`
    u.style.width = `${Math.abs(x)}px`
    for (const el of [u, own.current]) {
      if (!el) continue
      el.style[way.current === 1 ? "left" : "right"] = "0"
      el.style[way.current === 1 ? "right" : "left"] = ""
    }
  }, [])
  const close = useCallback(function close() {
    place(0, true)
    if (shut === close) shut = null
    setTimeout(() => { if (!at.current && !g.current) setShown([]) }, 240)
  }, [place])

  /** A button pressed: felt at once; one that removes the row slides it out and folds it away before it runs. */
  const act = (a: SwipeAction) => {
    haptic("medium")
    const el = box.current, r = row.current
    if (!a.removes || !el || !r) { close(); a.run(); return }
    if (shut === close) shut = null
    const t = "200ms cubic-bezier(.2,.8,.2,1)"
    el.style.height = `${el.offsetHeight}px`
    void el.offsetHeight
    el.style.transition = `height ${t}, opacity ${t}`
    el.style.height = "0px"
    el.style.opacity = "0"
    place(way.current * el.offsetWidth, true)
    const back = () => setTimeout(() => {
      if (!alive.current) return
      el.style.height = el.style.opacity = el.style.transition = ""
      place(0)
      setShown([])
    }, 100)
    setTimeout(() => { Promise.resolve().then(a.run).then(back, back) }, 200)
  }

  const down = (e: React.PointerEvent) => {
    // (Selecting, a tap picks a row: nothing slides.)
    if (e.pointerType !== "touch" || selecting()) return
    swiped.current = false
    if (shut && shut !== close) shut()
    if (!at.current) {
      const drawer = row.current?.closest<HTMLElement>("[data-phone-drawer]")?.dataset.phoneDrawer
      way.current = drawer === "left" ? 1 : -1
    }
    g.current?.quit?.()
    g.current = { x: e.clientX, y: e.clientY, from: at.current, axis: null, full: !!at.current, room: Math.abs(at.current) }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || s.axis === "y" || s.axis === "pass") return
    const mx = e.clientX - s.x, my = e.clientY - s.y
    if (!s.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        // Open already (either way back), or the way this row slides; the other way is the drawer's.
        if (!s.from && Math.sign(mx) !== way.current) { s.axis = "pass"; return }
        if (!s.from && behind) {
          s.room = own.current?.scrollWidth ?? 0
          if (!s.room) { s.axis = "pass"; return }
        } else if (!s.from) {
          const list = actions?.() ?? []
          if (!list.length) { s.axis = "pass"; return }
          setShown(list)
          setShort((row.current?.offsetHeight ?? 44) < 40)
          s.room = list.length * BUTTON
        }
        s.axis = "x"
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* gone */ }
        // The app sent away mid-swipe (core/away.ts): it settles as if let go there.
        s.quit = onAway(() => { if (g.current === s) { g.current = null; settle(s) } })
      } else if (Math.abs(my) > 8) { s.axis = "y"; return }
      else return
    }
    e.stopPropagation()
    swiped.current = true
    // Its way only, and past its buttons with resistance (a third of the finger's move).
    let x = way.current * Math.max(0, way.current * (s.from + mx))
    if (Math.abs(x) > s.room) x = way.current * (s.room + (Math.abs(x) - s.room) / 3)
    const full = Math.abs(x) >= s.room
    if (full && !s.full) haptic()
    s.full = full
    place(x)
  }
  const up = (e: React.PointerEvent) => {
    const s = g.current
    g.current = null
    if (!s || s.axis !== "x") return
    e.stopPropagation()
    settle(s)
  }
  /** Let go: open on its buttons past half of them, else closed. */
  const settle = (s: { room: number; quit?: () => void }) => {
    s.quit?.()
    if (Math.abs(at.current) > s.room / 2) { place(way.current * s.room, true); shut = close }
    else close()
  }

  return (
    <div {...rest} ref={box} className={cn("relative overflow-hidden", className)} style={{ touchAction: "pan-y" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClickCapture={(e) => {
        // Open, a tap on the row closes it (and opens nothing); the click a swipe ends with is no tap. Its buttons act.
        if (under.current?.contains(e.target as Node)) return
        if (swiped.current || at.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; if (at.current) close() }
      }}>
      <div ref={under} aria-hidden={!at.current} data-swipe-under
        // A finger held on a button is its press, not the menu of what holds the row.
        onContextMenu={(e) => e.stopPropagation()} className={cn("absolute inset-y-0 flex w-0 overflow-hidden", behind && "bg-foreground/[0.07]")} style={{ right: 0 }}>
        {behind ? (
          // As they are, a finger's size; one acts, then the row closes (after: a menu it opens is placed by it first).
          <span ref={own} onClickCapture={() => setTimeout(close)} className="absolute inset-y-0 flex text-foreground [&_button]:h-full [&_button]:w-10 [&_button]:rounded-none" style={{ right: 0 }}>
            {behind}
          </span>
        ) : shown.map((a) => (
          <button key={a.label} type="button" data-no-drag tabIndex={-1} aria-label={a.label}
            onClick={(e) => { e.stopPropagation(); act(a) }}
            className={cn("flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden text-[12px] font-medium whitespace-nowrap text-white",
              a.danger ? "bg-[var(--red)]" : "bg-[var(--blue)]")}>
            <a.icon className="size-5 shrink-0" strokeWidth={2} />
            {!short && a.label}
          </button>
        ))}
      </div>
      <div ref={row}>{children}</div>
    </div>
  )
}
