// A tab group's line (under its tabs in the bar, down their left in the Tabs panel) is one element, drawn each frame
// from where its chip and tabs are while they move: pieces carried by each tab broke apart as the tabs moved on their own.
import { useLayoutEffect, type RefObject } from "react"
import { moves, timing } from "@/core/animation"
import { replacingWorkspace } from "@/core/workspace"

const MOTION = "tab-motion"
/** Something in a list of tabs starts moving outside a render (a fold, a close): its groups' lines follow it. */
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
  // (after every render: what's drawn may have changed, or started moving)
  useLayoutEffect(() => { if (root.current) drawers.get(root.current)?.() })
}
/** Where a line starts (left, or top) and how long it is, in its list's px. */
type Span = [number, number]
const drawers = new WeakMap<HTMLElement, () => void>()

function lines(root: HTMLElement, axis: "x" | "y") {
  const drawn = new Map<string, HTMLElement>()
  /** Each line's start and length as drawn, which tabs it was drawn for, and its ends easing to a new place. */
  const spans = new Map<string, { who: string; at: Span; tween?: { from: Span; t0: number } }>()
  let raf = 0, calm = 0, last = ""

  /** Where each line goes now; what it was drawn as, to tell when nothing moves any more. */
  function draw() {
    const box = root.getBoundingClientRect(), k = root.offsetWidth / box.width || 1
    const heads = new Map<string, HTMLElement>()
    // (a group's chip and the copy of one going: the chip's)
    for (const h of root.querySelectorAll<HTMLElement>("[data-line-head]")) if (!heads.has(h.dataset.lineHead!) || !h.inert) heads.set(h.dataset.lineHead!, h)
    const sig: string[] = []
    const shown = new Set<string>()
    // Where each starts: a line stops short of the next group's chip, so a tab sliding in from past it (the blank tab
    // moved into a group) doesn't draw it across that group.
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
        // (a group just made fades its line in as its chip springs in; opened, it grows with its tabs)
        if (moves() && !replacingWorkspace() && head.getAnimations().length) line.animate([{ opacity: 0 }, {}], timing("base"))
      } else if (line.dataset.going !== undefined) {
        delete line.dataset.going
        for (const a of line.getAnimations()) if (a.id === "going") a.cancel()
      }
      const state = head.matches("[aria-expanded]") ? head : head.querySelector<HTMLElement>("[aria-expanded]")
      line.toggleAttribute("data-folded", state?.getAttribute("aria-expanded") === "false")
      line.toggleAttribute("data-moving", state?.dataset.groupMoving !== undefined)
      line.style.background = head.style.getPropertyValue("--line")
      // Where it goes: along the bar from the chip's label to the last tab's end; down the panel from the chip's middle
      // to the last tab's bottom. A tab joining or leaving it (not moving) eases the ends there rather than jumping.
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
        // (it ends rounded a little above the last tab's bottom, as it starts under the chip)
        line.style.height = `max(0px, ${at[1]}px - var(--spacing) * 2)`
      }
      sig.push(`${id}:${at[0].toFixed(2)},${at[1].toFixed(2)}`)
      sig.push(line.style.background, String(line.hasAttribute("data-folded")))
    }
    // Those no longer wanted (ungrouped, every tab dragged out): they fade where they were. Folded, it's gone already
    // (faded as its tabs shrank, or at once: an agent's fold).
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
  // Drawn again each frame till three in a row are the same: whatever moved has stopped.
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
    if (!raf && moves()) raf = requestAnimationFrame(tick)
  }
  root.addEventListener(MOTION, kick)
  // (a list making way for a drag slides by CSS transitions: core/slide.ts)
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
