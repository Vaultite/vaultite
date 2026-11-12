// Safari has no scroll anchoring and Chrome's anchors inside a card: the anchor here is the first whole card on screen.
import type { ChangeDesc } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { trace } from "@/core/trace"
import { trackSoon } from "@/core/unsaved"
import { scrollingBox } from "@/lib/utils"

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
    if (scrolled() <= 0) return
    const t = top()
    for (const el of grid.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect()
      if (r.height && r.bottom > t + 1) { anchor = el; offset = r.top - t; at = scrolled(); return }
    }
  }
  let frame = 0
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; pick() }) }
  ;(box ?? window).addEventListener("scroll", onScroll, { passive: true })
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

function inSight(box: HTMLElement | null, y: number): number {
  const r = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight }
  const pad = parseFloat(getComputedStyle(box ?? document.documentElement).scrollPaddingTop) || 0
  const bar = [...(box ?? document).querySelectorAll<HTMLElement>("[data-view-bar]")].find((b) => b.getClientRects().length)
  const top = Math.max(r.top + pad, bar ? bar.getBoundingClientRect().bottom : 0) + 8
  return Math.min(Math.max(y, top), Math.max(top, r.bottom - 160))
}

const holding = new Map<HTMLElement | Window, () => void>()
trackSoon("held scroll", () => holding.size > 0)
export function holdPlace(box: HTMLElement | null, off: () => number | null, opts: {
  measure?: (read: () => number | null, write: (d: number | null) => void) => void
  gone?: () => boolean; done?: () => void; there?: () => void
} = {}): () => void {
  const by = (d: number) => { if (box) box.scrollTop += d; else window.scrollBy(0, d) }
  let stopped = false, frame = 0, still = 0
  const until = performance.now() + 3000
  const events = ["wheel", "touchstart", "keydown", "pointerdown"]
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
    // CodeMirror can't dispatch inside its measure cycle, and `there` may move the cursor: it runs after.
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
export function textChanged(view: EditorView, c: ChangeDesc) { for (const f of changing.get(view) ?? []) f(c) }

export function keepOnScreen(view: EditorView, pos: number, top: (pos: number) => number | null, at: number, there?: () => void) {
  const follow = (c: ChangeDesc) => { pos = c.mapPos(pos, 1) }
  const all = changing.get(view) ?? new Set()
  changing.set(view, all.add(follow))
  const pane = view.dom.closest<HTMLElement>("[data-pane]")
  const box = scrollingBox(view.dom) ?? (pane && /auto|scroll/.test(getComputedStyle(pane).overflowY) ? pane : null), y = inSight(box, at)
  return holdPlace(box, () => { const t = top(pos); return t === null ? null : t - y },
    { measure: (read, write) => view.requestMeasure({ read, write }), gone: () => !view.dom.isConnected, there, done: () => all.delete(follow) })
}
