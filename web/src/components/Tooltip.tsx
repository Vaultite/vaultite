// Hover tooltips from `data-tip` (no wrapper; `data-tip-side`, `data-tip-trunc`). Mouse only, and never while a
// button is held (a drag: what it would say is under way).
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

type Tip = { text: string; x: number; y: number; side: "top" | "bottom" | "right" }

const DELAY = 450
const WARM = 500 // after one hides, the next shows without waiting for this long

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cur: Element | null = null
    let shown = false
    let warmUntil = 0
    const hide = () => {
      clearTimeout(timer)
      if (shown) warmUntil = Date.now() + WARM
      shown = false
      cur = null
      setTip(null)
    }
    /** Something's being dragged or resized (core/drag.ts, Resizer.tsx). */
    const busy = () => "resizing" in document.body.dataset || "dragging" in document.documentElement.dataset
    const show = (el: Element) => {
      if (cur !== el || !el.isConnected || busy()) return
      const text = el.getAttribute("data-tip")
      if (!text) return
      if (el.hasAttribute("data-tip-trunc")) {
        // Its label, or any part of it (a site and its account), cut off; a label hidden altogether, like a narrow
        // tab's, counts as cut off.
        const ts = [...el.querySelectorAll<HTMLElement>(".truncate")], t = ts[0] ?? (el as HTMLElement)
        if (t.getClientRects().length && !(ts.length ? ts : [t]).some((x) => x.scrollWidth > x.clientWidth)) return
      }
      const r = el.getBoundingClientRect()
      const want = el.getAttribute("data-tip-side")
      const side: Tip["side"] = want === "right" ? "right" : want === "top" || r.bottom + 44 > innerHeight ? "top" : "bottom"
      shown = true
      setTip(side === "right" ? { text, x: r.right + 8, y: r.top + r.height / 2, side }
        : { text, x: r.left + r.width / 2, y: side === "bottom" ? r.bottom + 8 : r.top - 8, side })
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null
      if (el === cur) return
      hide()
      if (!el) return
      cur = el
      if (Date.now() < warmUntil) show(el)
      else timer = setTimeout(() => show(el), DELAY)
    }
    const out = (e: PointerEvent) => { if (!e.relatedTarget) hide() } // left the window
    addEventListener("pointerover", over)
    document.addEventListener("pointerout", out)
    addEventListener("pointerdown", hide, true)
    addEventListener("keydown", hide, true)
    addEventListener("scroll", hide, true)
    addEventListener("blur", hide)
    return () => {
      clearTimeout(timer)
      removeEventListener("pointerover", over)
      document.removeEventListener("pointerout", out)
      removeEventListener("pointerdown", hide, true)
      removeEventListener("keydown", hide, true)
      removeEventListener("scroll", hide, true)
      removeEventListener("blur", hide)
    }
  }, [])
  return tip ? createPortal(<Bubble tip={tip} />, document.body) : null
}

function Bubble({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  // Keep it on screen: slide the label, not the arrow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || tip.side === "right") return setShift(0)
    const w = el.offsetWidth
    const left = tip.x - w / 2
    setShift(left < 8 ? 8 - left : left + w > innerWidth - 8 ? innerWidth - 8 - (left + w) : 0)
  }, [tip])
  const place = tip.side === "right"
    ? { left: tip.x, top: tip.y, transform: "translateY(-50%)" }
    : { left: tip.x + shift, top: tip.y, transform: `translate(-50%, ${tip.side === "top" ? "-100%" : "0"})` }
  const arrow = tip.side === "right"
    ? { left: -4, top: "50%", marginTop: -4 }
    : { left: `calc(50% - ${shift}px - 4px)`, [tip.side === "top" ? "bottom" : "top"]: -4 }
  return (
    <div ref={ref} role="tooltip" style={place}
      data-floats className="tooltip pointer-events-none fixed z-[100] w-max max-w-[320px] rounded-[6px] px-2.5 py-1.5 text-center text-[13px] leading-[17px] font-medium whitespace-pre-line">
      <span aria-hidden className="tooltip-arrow absolute size-2 rotate-45" style={arrow} />
      <span className="relative">{tip.text}</span>
    </div>
  )
}
