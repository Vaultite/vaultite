// Scroll anchoring for a page of cards: Safari has none and Chrome anchors inside a card, so here the anchor is the
// first whole card on screen, and the page is scrolled back by however far it moved. And holding one thing in place.
import type { ChangeDesc } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { trace } from "@/core/trace"
import { scrollingBox } from "@/lib/utils"

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

/** Where on screen (a y) something held at `y` goes so it's in sight in `box` (null: the window): below what's stuck
 *  at its top (a pane's view bar, a phone's header), with room under it for a few lines. */
function inSight(box: HTMLElement | null, y: number): number {
  const r = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight }
  const pad = parseFloat(getComputedStyle(box ?? document.documentElement).scrollPaddingTop) || 0
  const bar = [...(box ?? document).querySelectorAll<HTMLElement>("[data-view-bar]")].find((b) => b.getClientRects().length)
  const top = Math.max(r.top + pad, bar ? bar.getBoundingClientRect().bottom : 0) + 8
  return Math.min(Math.max(y, top), Math.max(top, r.bottom - 160))
}

const holding = new Map<HTMLElement | Window, () => void>()
/** Scroll `box` (null: the window) by `off()`, how far something is below its place (null: not drawn yet), each frame
 *  (`measure`: an editor's) until still for half a second, 3 s at most, or the reader acts; `there`: first in place. */
export function holdPlace(box: HTMLElement | null, off: () => number | null, opts: {
  measure?: (read: () => number | null, write: (d: number | null) => void) => void
  gone?: () => boolean; done?: () => void; there?: () => void
} = {}): () => void {
  const by = (d: number) => { if (box) box.scrollTop += d; else window.scrollBy(0, d) }
  let stopped = false, frame = 0, still = 0
  const until = performance.now() + 3000
  const events = ["wheel", "touchstart", "keydown", "pointerdown"]
  // (one hold per scroller: a newer one, for what the reader did since, wins)
  const key = box ?? window
  holding.get(key)?.()
  const stop = (e?: Event) => {
    if (stopped) return
    stopped = true
    if (holding.get(key) === stop) holding.delete(key)
    trace("scroll", { held: "stop", by: e?.type ?? "settled" })
    cancelAnimationFrame(frame)
    for (const t of events) removeEventListener(t, stop, true)
    opts.done?.()
  }
  for (const t of events) addEventListener(t, stop, { capture: true, passive: true })
  holding.set(key, stop)
  const apply = (d: number | null) => {
    if (stopped) return
    // (`there` out of the editor's measure cycle, which this may be: it may put the cursor in the text)
    if (d === null) still = 0
    else if (Math.abs(d) >= 1) { trace("scroll", { held: Math.round(d) }); by(d); still = 0 } else if (++still === 1 && opts.there) setTimeout(opts.there, 0)
    if (still > 30) return stop()
    frame = requestAnimationFrame(step)
  }
  const step = () => {
    if (stopped) return
    if (performance.now() > until || opts.gone?.()) return stop()
    if (opts.measure) opts.measure(off, apply)
    else apply(off())
  }
  step()
  return stop
}

const changing = new WeakMap<EditorView, Set<(c: ChangeDesc) => void>>()
/** An editor's text changed (Editor.tsx tells every change): what holds a place in it follows. */
export function textChanged(view: EditorView, c: ChangeDesc) { for (const f of changing.get(view) ?? []) f(c) }

/** Keep what's at `pos` in an editor (`top`: where it's drawn, a y on screen) at `at`, in sight, while the text around
 *  it settles (blocks drawn anew above it, the server stamping the frontmatter); `there`: once it's first in place. */
export function keepOnScreen(view: EditorView, pos: number, top: (pos: number) => number | null, at: number, there?: () => void) {
  const follow = (c: ChangeDesc) => { pos = c.mapPos(pos, 1) }
  const all = changing.get(view) ?? new Set()
  changing.set(view, all.add(follow))
  // (its pane even when the text doesn't overflow it yet: an editor just drawn grows as its blocks come)
  const pane = view.dom.closest<HTMLElement>("[data-pane]")
  const box = scrollingBox(view.dom) ?? (pane && /auto|scroll/.test(getComputedStyle(pane).overflowY) ? pane : null), y = inSight(box, at)
  return holdPlace(box, () => { const t = top(pos); return t === null ? null : t - y },
    { measure: (read, write) => view.requestMeasure({ read, write }), gone: () => !view.dom.isConnected, there, done: () => all.delete(follow) })
}
