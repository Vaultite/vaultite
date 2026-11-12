// Hover tooltips from `data-tip` (no wrapper; `data-tip-side`, `data-tip-trunc`, `data-tip-cut`: what it says instead
// while its label is cut off). Mouse only, and never while a button is held (a drag: what it would say is under way).
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { fadeAway } from "@/core/animation"

type Tip = { text: string; x: number; y: number; side: "top" | "bottom" | "left" | "right" }

const DELAY = 450
const WARM = 500 // after one hides, the next shows without waiting for this long

/** The tooltips of `data-tip` in window `win`: the app's, or a popup's it draws in from here (a presenter view). */
export const Tooltips = memo(function Tooltips({ win = window }: { win?: Window }) {
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cur: Element | null = null
    let shown = false
    let warmUntil = 0
    /** `fade`: the pointer left it for nothing with a tip, and it fades as a Mac's does (a click or key: gone at once). */
    const hide = (fade = false) => {
      if (fade && shown) fadeAway([win.document.querySelector(".tooltip[role=tooltip]")])
      clearTimeout(timer)
      if (shown) warmUntil = Date.now() + WARM
      shown = false
      cur = null
      setTip(null)
    }
    /** Its label, or any part of it (a site and its account), cut off; a label hidden altogether, like a narrow tab's,
     *  counts as cut off. */
    const cut = (el: Element) => {
      const ts = [...el.querySelectorAll<HTMLElement>(".truncate, .fade-end")], t = ts[0] ?? (el as HTMLElement)
      return !t.getClientRects().length || (ts.length ? ts : [t]).some((x) => x.scrollWidth > x.clientWidth || under(x))
    }
    /** Its text runs under what's drawn over its end (`--fade-reserve`: a sidebar row's buttons on hover). */
    const under = (x: HTMLElement) => {
      const kept = parseFloat(getComputedStyle(x).getPropertyValue("--fade-reserve")) || 0
      if (!kept) return false
      const r = document.createRange()
      r.selectNodeContents(x)
      return r.getBoundingClientRect().width > x.clientWidth - kept
    }
    /** Something's being dragged or resized (core/drag.ts, Resizer.tsx). */
    const busy = () => "resizing" in document.body.dataset || "dragging" in document.documentElement.dataset
    const show = (el: Element) => {
      if (cur !== el || !el.isConnected || busy()) return
      const whenCut = el.getAttribute("data-tip-cut")
      const text = whenCut && cut(el) ? whenCut : el.getAttribute("data-tip")
      if (!text) return
      if (el.hasAttribute("data-tip-trunc") && !cut(el)) return
      const r = el.getBoundingClientRect()
      const want = el.getAttribute("data-tip-side")
      const side: Tip["side"] = want === "right" || want === "left" ? want : want === "top" || r.bottom + 44 > win.innerHeight ? "top" : "bottom"
      shown = true
      setTip(side === "right" || side === "left" ? { text, x: side === "right" ? r.right + 8 : r.left - 8, y: r.top + r.height / 2, side }
        : { text, x: r.left + r.width / 2, y: side === "bottom" ? r.bottom + 8 : r.top - 8, side })
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null
      if (el === cur) return
      hide(!el)
      if (!el) return
      cur = el
      if (Date.now() < warmUntil) show(el)
      else timer = setTimeout(() => show(el), DELAY)
    }
    const out = (e: PointerEvent) => { if (!e.relatedTarget) hide(true) } // left the window
    const now = () => hide()
    win.addEventListener("pointerover", over)
    win.document.addEventListener("pointerout", out)
    win.addEventListener("pointerdown", now, true)
    win.addEventListener("keydown", now, true)
    win.addEventListener("scroll", now, true)
    win.addEventListener("blur", now)
    return () => {
      clearTimeout(timer)
      win.removeEventListener("pointerover", over)
      win.document.removeEventListener("pointerout", out)
      win.removeEventListener("pointerdown", now, true)
      win.removeEventListener("keydown", now, true)
      win.removeEventListener("scroll", now, true)
      win.removeEventListener("blur", now)
    }
  }, [win])
  return tip ? createPortal(<Bubble tip={tip} win={win} />, win.document.body) : null
})

function Bubble({ tip, win }: { tip: Tip; win: Window }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  // Keep it on screen: slide the label, not the arrow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || tip.side === "right" || tip.side === "left") return setShift(0)
    const w = el.offsetWidth
    const left = tip.x - w / 2
    setShift(left < 8 ? 8 - left : left + w > win.innerWidth - 8 ? win.innerWidth - 8 - (left + w) : 0)
  }, [tip, win])
  const place = tip.side === "right" || tip.side === "left"
    ? { left: tip.x, top: tip.y, transform: tip.side === "left" ? "translate(-100%, -50%)" : "translateY(-50%)" }
    : { left: tip.x + shift, top: tip.y, transform: `translate(-50%, ${tip.side === "top" ? "-100%" : "0"})` }
  const arrow = tip.side === "right" || tip.side === "left"
    ? { [tip.side === "right" ? "left" : "right"]: -4, top: "50%", marginTop: -4 }
    : { left: `calc(50% - ${shift}px - 4px)`, [tip.side === "top" ? "bottom" : "top"]: -4 }
  return (
    <div ref={ref} role="tooltip" style={place}
      data-floats className="tooltip pointer-events-none fixed z-[100] w-max max-w-[320px] rounded-[6px] px-2.5 py-1.5 text-center text-[13px] leading-[17px] font-medium whitespace-pre-line">
      <span aria-hidden className="tooltip-arrow absolute size-2 rotate-45" style={arrow} />
      <span className="relative">{tip.text}</span>
    </div>
  )
}
