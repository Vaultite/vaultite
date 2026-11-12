import { useLayoutEffect, type RefObject } from "react"
import { moves, timing } from "@/core/animation"
import { replacingWorkspace } from "@/core/workspace"

export const MOTION = "tab-motion"
export const stir = (el: Element | null | undefined) => { el?.dispatchEvent(new Event(MOTION, { bubbles: true })) }

/** `root`'s tab groups' lines: a group's chip is its `data-line-head` (its colour `--line`), each tab drawn in it (a
 *  drag's preview's, a closed one's copy) `data-line-of`; along the bar (x) or down the panel (y). */
export function useGroupLines(root: RefObject<HTMLElement | null>, axis: "x" | "y") {
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const l = lines(el, axis)
    drawers.set(el, l.kick)
    return () => { drawers.delete(el); l.stop() }
  }, [root, axis])
  useLayoutEffect(() => { if (root.current) drawers.get(root.current)?.() })
}
type Span = [number, number]
const drawers = new WeakMap<HTMLElement, () => void>()

function lines(root: HTMLElement, axis: "x" | "y") {
  const drawn = new Map<string, HTMLElement>()
  const spans = new Map<string, { who: string; at: Span; tween?: { from: Span; t0: number } }>()
  let raf = 0, calm = 0, last = ""

  function draw() {
    const heads = new Map<string, HTMLElement>()
    for (const h of root.querySelectorAll<HTMLElement>("[data-line-head]")) if (!heads.has(h.dataset.lineHead!) || !h.inert) heads.set(h.dataset.lineHead!, h)
    if (!heads.size && !drawn.size) return ""
    const box = root.getBoundingClientRect(), k = root.offsetWidth / box.width || 1
    const sig: string[] = []
    const shown = new Set<string>()
    const startOf = (head: HTMLElement) => {
      const r = (axis === "x" ? head.querySelector("[data-group-name]") ?? head : head).getBoundingClientRect()
      return axis === "x" ? r.left : r.top
    }
    const starts = [...heads.values()].filter((h) => h.getClientRects().length).map(startOf)
    const css = getComputedStyle(root), gap = parseFloat(axis === "x" ? css.columnGap : css.rowGap) || 0
    for (const [id, head] of heads) {
      const els = [...root.querySelectorAll<HTMLElement>(`[data-line-of="${CSS.escape(id)}"]`)]
      const tabs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height)
      if (!tabs.length || !head.getClientRects().length) continue
      shown.add(id)
      let line = drawn.get(id)
      if (!line) {
        line = document.createElement("span")
        line.setAttribute("aria-hidden", "true")
        line.dataset.groupLine = id
        line.dataset.axis = axis
        root.append(line)
        drawn.set(id, line)
        if (moves() && !replacingWorkspace() && head.getAnimations().length) line.animate([{ opacity: 0 }, {}], timing("base"))
      } else if (line.dataset.going !== undefined) {
        delete line.dataset.going
        for (const a of line.getAnimations()) if (a.id === "going") a.cancel()
      }
      const state = head.matches("[aria-expanded]") ? head : head.querySelector<HTMLElement>("[aria-expanded]")
      line.toggleAttribute("data-folded", state?.getAttribute("aria-expanded") === "false")
      line.toggleAttribute("data-moving", state?.dataset.groupMoving !== undefined)
      line.style.background = head.style.getPropertyValue("--line")
      const h = head.getBoundingClientRect(), from = axis === "x" ? (head.querySelector("[data-group-name]") ?? head).getBoundingClientRect().left : h.top + h.height / 2
      const next = Math.min(...starts.filter((x) => x > from + 0.5)) - gap
      const to = Math.min(next, Math.max(...tabs.map((r) => (axis === "x" ? r.right : r.bottom))))
      const goal: Span = [(from - (axis === "x" ? box.left : box.top)) * k + (axis === "x" ? root.scrollLeft : root.scrollTop), Math.max(0, (to - from) * k)]
      const who = els.map((e) => e.dataset.slide ?? "").join()
      const was = spans.get(id), now = performance.now(), d = timing("base").duration
      let tween = was?.tween
      if (was && was.who !== who && d) tween = { from: was.at, t0: now }
      const p = tween ? Math.min(1, (now - tween.t0) / d) : 1, e = 1 - (1 - p) ** 4
      const eased: Span = tween && p < 1 ? [tween.from[0] + (goal[0] - tween.from[0]) * e, tween.from[1] + (goal[1] - tween.from[1]) * e] : goal
      const at: Span = [eased[0], Math.max(0, Math.min(eased[1], (next - from) * k))]
      spans.set(id, { who, at, tween: p < 1 ? tween : undefined })
      if (axis === "x") {
        line.style.left = `${at[0]}px`
        line.style.width = `${at[1]}px`
      } else {
        line.style.top = `${at[0]}px`
        line.style.height = `max(0px, ${at[1]}px - var(--spacing) * 2)`
      }
      sig.push(`${id}:${at[0].toFixed(2)},${at[1].toFixed(2)}`)
      sig.push(line.style.background, String(line.hasAttribute("data-folded")))
    }
    for (const [id, line] of drawn) {
      if (shown.has(id) || line.dataset.going !== undefined) continue
      spans.delete(id)
      const head = heads.get(id), state = head && (head.matches("[aria-expanded]") ? head : head.querySelector("[aria-expanded]"))
      if (!moves() || replacingWorkspace() || state?.getAttribute("aria-expanded") === "false") { line.remove(); drawn.delete(id); continue }
      line.dataset.going = ""
      const a = line.animate([{}, { opacity: 0 }], { ...timing("base"), fill: "forwards" })
      a.id = "going"
      a.finished.then(() => { if (drawn.get(id) === line && line.dataset.going !== undefined) { line.remove(); drawn.delete(id) } }, () => {})
    }
    return sig.join("|")
  }
  const tick = () => {
    raf = 0
    const s = draw()
    calm = s === last ? calm + 1 : 0
    last = s
    if (calm < 3) raf = requestAnimationFrame(tick)
  }
  const kick = () => {
    last = draw()
    calm = 0
    if (!raf && moves() && (last || drawn.size)) raf = requestAnimationFrame(tick)
  }
  root.addEventListener(MOTION, kick)
  root.addEventListener("transitionrun", kick)
  const ro = new ResizeObserver(kick)
  ro.observe(root)
  kick()
  return {
    kick,
    stop() {
      cancelAnimationFrame(raf)
      root.removeEventListener(MOTION, kick)
      root.removeEventListener("transitionrun", kick)
      ro.disconnect()
      for (const line of drawn.values()) line.remove()
    },
  }
}
