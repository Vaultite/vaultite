// Scroll anchoring for a page of cards: Safari has none and Chrome anchors inside a card, so here the anchor is the
// first whole card on screen, and the page is scrolled back by however far it moved.
import { trace } from "@/core/trace"

/** What scrolls `el`: the nearest box that scrolls, or null for the window. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p === document.body || p === document.documentElement) return null
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

/** Keep `cards` (the elements `grid` is made of, `selector`) anchored while `grid` is on the page. Returns a stop. */
export function keepAnchored(grid: HTMLElement, selector: string): () => void {
  const box = scrollerOf(grid)
  const top = () => (box ? box.getBoundingClientRect().top : 0)
  const scrolled = () => (box ? box.scrollTop : scrollY)
  const scrollBy = (d: number) => { if (box) box.scrollTop += d; else window.scrollBy(0, d) }
  grid.dataset.anchored = ""
  let anchor: HTMLElement | null = null
  let offset = 0, at = 0
  const pick = () => {
    anchor = null
    if (scrolled() <= 0) return // at the very top, nothing to keep: what's added comes in below
    const t = top()
    for (const el of grid.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect()
      if (r.height && r.bottom > t + 1) { anchor = el; offset = r.top - t; at = scrolled(); return }
    }
  }
  let frame = 0
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; pick() }) }
  ;(box ?? window).addEventListener("scroll", onScroll, { passive: true })
  // After layout: where the anchor is against where scrolling alone would have put it.
  const sizes = new ResizeObserver(() => {
    if (!anchor?.isConnected || !grid.getClientRects().length) return pick()
    const now = anchor.getBoundingClientRect().top - top()
    const d = now - (offset - (scrolled() - at))
    if (Math.abs(d) < 1) return
    trace("scroll", { anchor: anchor.dataset.line, moved: Math.round(d) })
    scrollBy(d)
    offset = anchor.getBoundingClientRect().top - top()
    at = scrolled()
  })
  const watch = () => { for (const el of grid.querySelectorAll<HTMLElement>(selector)) sizes.observe(el) }
  watch()
  // (cards added or taken away: watched too)
  const added = new MutationObserver(watch)
  added.observe(grid, { childList: true, subtree: false })
  pick()
  return () => {
    cancelAnimationFrame(frame)
    ;(box ?? window).removeEventListener("scroll", onScroll)
    sizes.disconnect()
    added.disconnect()
    delete grid.dataset.anchored
  }
}
