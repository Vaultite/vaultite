import { useEffect, useRef, useState, type RefObject } from "react"
import { GRID, zoomAbout, type View } from "./geometry"

const FAR_K = 0.3
const DOTS = "radial-gradient(circle, color-mix(in srgb, var(--muted-foreground) 28%, transparent) 1px, transparent 1px)"
type Rect = { x0: number; y0: number; x1: number; y1: number }

export function useView() {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const zoomLabel = useRef<HTMLSpanElement>(null)
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 })
  const [win, setWin] = useState<(Rect & { far: boolean }) | null>(null)
  const winRef = useRef(win)
  // oxlint-disable-next-line react/refs -- cull runs between renders and reads the window it just set
  winRef.current = win
  const cullFrame = useRef(0)
  const cull = () => {
    cullFrame.current = 0
    const el = box.current
    if (!el) return
    const v = viewRef.current, w = el.clientWidth / v.k, h = el.clientHeight / v.k
    const seen = { x0: -v.x / v.k, y0: -v.y / v.k, x1: -v.x / v.k + w, y1: -v.y / v.k + h }
    const far = v.k < FAR_K
    const cur = winRef.current
    if (cur && cur.far === far && seen.x0 >= cur.x0 && seen.y0 >= cur.y0 && seen.x1 <= cur.x1 && seen.y1 <= cur.y1 && cur.x1 - cur.x0 < 4 * w) return
    const next = { x0: seen.x0 - w, y0: seen.y0 - h, x1: seen.x1 + w, y1: seen.y1 + h, far }
    winRef.current = next
    setWin(next)
  }
  const bar = useRef<HTMLDivElement>(null)
  const barAt = useRef<{ x: number; top: number; bottom: number } | null>(null)
  const placeBar = () => {
    const el = bar.current, at = barAt.current, root = box.current
    if (!el || !at || !root) return
    const v = viewRef.current, w = el.offsetWidth, h = el.offsetHeight, gap = 10
    let y = at.top * v.k + v.y - h - gap
    if (y < gap) y = at.bottom * v.k + v.y + gap
    if (y + h > root.clientHeight - gap) y = gap
    const x = Math.max(gap, Math.min(root.clientWidth - w - gap, at.x * v.k + v.x - w / 2))
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
  }
  const paint = () => {
    const v = viewRef.current, el = box.current, st = stage.current
    if (!el || !st) return
    st.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
    // Setting --k, or the label's text even unchanged, makes the browser restyle the whole page.
    if (el.style.getPropertyValue("--k") !== String(v.k)) {
      el.style.setProperty("--k", String(v.k))
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(v.k * 100)}%`
    }
    const dots = GRID * v.k >= 8 ? "on" : "off"
    if (el.dataset.dots !== dots) { el.dataset.dots = dots; el.style.backgroundImage = dots === "on" ? DOTS : "none" }
    el.style.backgroundSize = `${GRID * v.k}px ${GRID * v.k}px`
    el.style.backgroundPosition = `${v.x}px ${v.y}px`
    placeBar()
    if (!cullFrame.current) cullFrame.current = requestAnimationFrame(cull)
  }
  const anim = useRef(0)
  const setView = (v: View) => { if (anim.current) { cancelAnimationFrame(anim.current); anim.current = 0 } viewRef.current = v; paint() }
  const animateTo = (to: View) => {
    const el = box.current
    if (!el) return
    if (anim.current) cancelAnimationFrame(anim.current)
    const from = viewRef.current, w = el.clientWidth / 2, h = el.clientHeight / 2
    const c0 = { x: (w - from.x) / from.k, y: (h - from.y) / from.k }, c1 = { x: (w - to.x) / to.k, y: (h - to.y) / to.k }
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - p, 3)
      const k = from.k * Math.pow(to.k / from.k, e)
      const cx = c0.x + (c1.x - c0.x) * e, cy = c0.y + (c1.y - c0.y) * e
      viewRef.current = p >= 1 ? to : { k, x: w - cx * k, y: h - cy * k }
      paint()
      anim.current = p < 1 ? requestAnimationFrame(tick) : 0
    }
    anim.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => { cancelAnimationFrame(anim.current); cancelAnimationFrame(cullFrame.current) }, [])
  return { box, stage, zoomLabel, viewRef, win, winRef, cull, bar, barAt, placeBar, paint, anim, setView, animateTo }
}

// A trackpad pinch arrives as a wheel event with ctrlKey.
export function useWheel(box: RefObject<HTMLDivElement | null>, embed: boolean, viewRef: RefObject<View>, setView: (v: View) => void) {
  useEffect(() => {
    const el = box.current
    if (!el || embed) return
    const wheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-scrolls], [data-editing]") && !e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const v = viewRef.current
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (!e.ctrlKey && !e.metaKey) {
        const side = e.shiftKey && !e.deltaX
        setView({ ...v, x: v.x - (side ? e.deltaY : e.deltaX) * unit, y: v.y - (side ? 0 : e.deltaY) * unit })
        return
      }
      const r = el.getBoundingClientRect()
      setView(zoomAbout(v, v.k * Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed])
}
