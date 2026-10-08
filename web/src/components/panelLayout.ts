// Lays out a sidebar whose panels each scroll in their own box (core/sidebars.ts' math). Heights go straight onto the
// boxes, not through React, so they follow content and drags in the same frame without redrawing components.
import { useLayoutEffect, useState, type RefObject } from "react"
import { dragPanels, fitPanels, heightIn, heightsAfterDrag, type PanelFit, type Sidebars } from "../../../core/sidebars.ts"
import { setPanelHeights, type PanelOf } from "@/core/plugins"

/** A sidebar measured: its panels (keys, in order), each one's fit, the room its gaps take outside its box,
 *  its box; the room for them all, and the sidebar's height (what saved heights are in proportion to: heightIn). */
type Laid = { keys: string[]; ps: PanelFit[]; chrome: number[]; boxes: HTMLElement[]; room: number; at: number }

/** How many rows a panel that draws more keeps when room runs short, its heading's height counting as one. */
const LEAST_ROWS = 4

function measure(body: HTMLElement, s: Sidebars, greedy: Set<string>): Laid {
  const cs = getComputedStyle(body)
  const at = body.clientHeight
  // The room from the body's real height: clientHeight is rounded (838.5px reads 839), and half a pixel too many puts
  // the panels past the bottom, so the sidebar scrolls by it.
  const room = Math.floor(body.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))
  const l: Laid = { keys: [], ps: [], chrome: [], boxes: [], room, at }
  for (const w of body.children) {
    if (!(w instanceof HTMLElement) || !w.dataset.panel) continue
    const box = w.querySelector<HTMLElement>(":scope > [data-panel-scroll]"), inner = box?.firstElementChild
    if (!box || !inner) continue
    const chrome = w.getBoundingClientRect().height - box.getBoundingClientRect().height
    // A row is as tall as a heading (both follow density).
    const row = inner.querySelector<HTMLElement>("[data-panel-handle]:not([data-sidebar-search])")?.offsetHeight || 28
    const key = w.dataset.panel
    l.keys.push(key); l.chrome.push(chrome); l.boxes.push(box)
    l.ps.push({ content: Math.ceil(chrome + inner.getBoundingClientRect().height), min: Math.ceil(chrome + row * LEAST_ROWS),
      height: heightIn(s, key, at), greedy: greedy.has(key), fixed: "collapsed" in w.dataset })
  }
  return l
}

/** Gives each box its height, and marks the body `data-overflow` when the panels, all at their least, are taller than
 *  the room: only then does the sidebar scroll as a whole (index.css), never by a stray pixel. */
function draw(body: HTMLElement, l: Laid, hs: number[]) {
  l.boxes.forEach((b, i) => {
    const v = l.ps[i].fixed ? "" : `${Math.max(0, hs[i] - l.chrome[i])}px`
    if (b.style.height !== v) b.style.height = v
  })
  body.toggleAttribute("data-overflow", hs.reduce((n, h) => n + h, 0) > l.room)
}

/** One sidebar's layout: what it was told last (whether it lays out, the setup, which panels are greedy), a divider's
 *  drag, and the heights it drew. */
class PanelLayout {
  on = false
  setup: Sidebars | null = null
  greedy = new Set<string>()
  /** A divider being dragged: the sidebar as it was measured then, which divider (under panel `i`), where the pointer
   *  started, the heights then and now. */
  drag: null | { l: Laid; i: number; y: number; start: number[]; now?: number[] } = null
  /** The heights a drag left, drawn until its saved heights come back (the setup changes). */
  held: null | { setup: Sidebars; hs: number[]; until: number } = null
  /** The heights drawn last. */
  last: null | { keys: string[]; hs: number[] } = null
  box: RefObject<HTMLDivElement | null>
  constructor(box: RefObject<HTMLDivElement | null>) { this.box = box }

  update(on: boolean, setup: Sidebars, panels: PanelOf[]) {
    if (this.on && !on) {
      // Scrolling as one again: the boxes lose their heights.
      this.box.current?.querySelectorAll<HTMLElement>("[data-panel-scroll]").forEach((b) => { b.style.height = "" })
      this.box.current?.removeAttribute("data-overflow")
      this.last = null
    }
    this.on = on
    this.setup = setup
    this.greedy = new Set(panels.filter((p) => p.panel.tall).map((p) => p.key))
  }

  layout = () => {
    const body = this.box.current
    if (!this.on || !body || !this.setup || this.drag) return
    const l = measure(body, this.setup, this.greedy)
    const h = this.held
    const held = h && h.setup === this.setup && Date.now() < h.until && h.hs.length === l.keys.length ? h.hs : null
    if (!held) this.held = null
    const hs = held ?? fitPanels(l.ps, l.room)
    draw(body, l, hs)
    this.last = { keys: l.keys, hs }
  }

  /** A divider's drag begins: the one under panel `key`, the pointer at `y`. */
  start = (key: string, y: number) => {
    const body = this.box.current
    if (!body || !this.setup) return
    const l = measure(body, this.setup, this.greedy), i = l.keys.indexOf(key)
    if (i < 0) return
    const start = this.last && this.last.keys.join() === l.keys.join() ? this.last.hs : fitPanels(l.ps, l.room)
    this.drag = { l, i, y, start }
  }

  move = (y: number) => {
    const d = this.drag
    if (!d) return
    d.now = dragPanels(d.l.ps, d.start, d.i, y - d.y)
    if (this.box.current) draw(this.box.current, d.l, d.now)
  }

  /** Let go: save the heights the layout needs to draw the panels so again. */
  end = () => {
    const d = this.drag
    this.drag = null
    if (!d?.now || !this.setup) return
    const change = heightsAfterDrag(d.l.ps, d.l.room, d.now)
    if (!change.size) return this.layout()
    this.held = { setup: this.setup, hs: d.now, until: Date.now() + 2000 }
    this.last = { keys: d.l.keys, hs: d.now }
    setPanelHeights(Object.fromEntries([...change].map(([j, px]) => [d.l.keys[j], px])), d.l.at)
  }
}

/** Lays out the panels in `box` (the sidebar's body) while `on`, and gives its dividers what to call (`start`, `move`,
 *  `end`). `panels`: the sidebar's, for which take what's left (`tall`: the file tree). */
export function usePanelLayout(box: RefObject<HTMLDivElement | null>, on: boolean, setup: Sidebars, panels: PanelOf[]) {
  const [fit] = useState(() => new PanelLayout(box))
  // After every render (a panel folded, added or moved; the saved heights changed), before it's painted.
  useLayoutEffect(() => {
    fit.update(on, setup, panels)
    fit.layout()
  })
  // And whenever what a panel draws or the sidebar's height changes.
  const shape = `${panels.map((p) => p.key).join()}|${setup.collapsed.join()}`
  useLayoutEffect(() => {
    const body = box.current
    if (!on || !body) return
    const ro = new ResizeObserver(() => fit.layout())
    ro.observe(body)
    for (const el of body.querySelectorAll(":scope > [data-panel] > [data-panel-scroll] > [data-panel-content]")) ro.observe(el)
    return () => ro.disconnect()
  }, [on, shape, box, fit])
  return fit
}
