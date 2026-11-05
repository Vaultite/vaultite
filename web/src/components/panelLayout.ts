// Lays out a sidebar whose panels each scroll in their own box (core/sidebars.ts' math). Heights go straight onto the
// boxes, not through React, so they follow content and drags in the same frame without redrawing components.
import { useLayoutEffect, useState, type RefObject } from "react"
import { dragPanels, fitPanels, heightIn, heightsAfterDrag, type PanelFit, type Sidebars } from "../../../core/sidebars.ts"
import { setPanelHeights, type PanelOf } from "@/core/plugins"
import { MOTION } from "@/core/tabline"

/** A sidebar measured: its panels (keys, in order), each one's fit, chrome (gaps outside its box), box, what moves in it
 *  and its height once that settles; the room for them all, the sidebar's height (saved heights' scale: heightIn). */
type Laid = { keys: string[]; ps: PanelFit[]; chrome: number[]; boxes: HTMLElement[]; moving: Settling[][]; rest: number[]; room: number; at: number }
type Settling = { el: Element; by: number }

/** The gap after `el` in the list it's in (through `display: contents` wrappers). */
function gapAfter(el: Element) {
  let p = el.parentElement
  while (p && getComputedStyle(p).display === "contents") p = p.parentElement
  return p ? parseFloat(getComputedStyle(p).rowGap) || 0 : 0
}

/** Elements in `box` whose height is moving (a tab group's rows growing in, a row folding away), each with how much
 *  taller it will be at rest, the outermost only. */
function settling(box: HTMLElement): Settling[] {
  const out: Settling[] = []
  for (const a of box.getAnimations({ subtree: true })) {
    const fx = a.effect as KeyframeEffect | null, el = fx?.target, end = fx?.getKeyframes().at(-1)
    if (!el || !end || end.height == null || a.playState === "finished") continue
    // (in px as layout keeps them, 1/64ths toward zero: computed margins mid-way are finer, a row's error a pixel in ten)
    const css = getComputedStyle(el), px = (v: unknown, now: string) => Math.trunc((parseFloat(String(v ?? now)) || 0) * 64) / 64
    // (one going to nothing is going: taken out, with the gap after it in its list)
    const rest = px(end.height, "0") === 0 ? -gapAfter(el)
      : px(end.height, "0") + px(end.marginTop ?? end.marginBlockStart ?? end.marginBlock, css.marginTop) + px(end.marginBottom ?? end.marginBlockEnd ?? end.marginBlock, css.marginBottom)
    const by = rest - (el.getBoundingClientRect().height + px(null, css.marginTop) + px(null, css.marginBottom))
    if (Math.abs(by) > 0.01) out.push({ el, by })
  }
  return out.filter((x) => !out.some((y) => y !== x && y.el.contains(x.el)))
}

/** Where a panel's rows end once what moves in it has settled, from the top of what it draws: its headings' and rows'
 *  bottoms (where they are mid-way, the panel's snapped end jumped a row each frame, and the panels under it). */
function rowEnds(l: Laid, i: number): number[] {
  const inner = l.boxes[i].firstElementChild, moving = l.moving[i]
  if (!inner) return []
  const top = inner.getBoundingClientRect().top
  const rows = [...inner.querySelectorAll<HTMLElement>("[data-panel-handle], [data-keyrow]")]
  return rows.filter((r) => !moving.some((m) => m.el.contains(r) && m.by < -(m.el.getBoundingClientRect().height - 0.5)))
    .map((r) => r.getBoundingClientRect().bottom - top + moving.reduce((n, m) => (!m.el.contains(r) && m.el.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING ? n + m.by : n), 0))
}

/** How far apart a row's end and a panel's may be and still meet: mid-motion the ends are projected (`rowEnds`), a hair
 *  off where they'll be at rest, and a hair rounded the other way put the panel's end a pixel off for a frame. */
const SLACK = 0.25

/** A scrolling panel ends between two rows, not a sliver into the next (above, or below to keep its least); the greedy
 *  one (the tree) takes the difference, then with `tree` ends between two rows too, the rest left empty. */
function snapToRows(l: Laid, hs: number[], tree = true): number[] {
  const out = [...hs]
  const g = l.ps.findIndex((p, i) => p.greedy && !p.fixed && out[i] < p.content)
  let freed = 0
  l.ps.forEach((p, i) => {
    if (p.greedy || p.fixed || out[i] >= p.content) return
    const room = out[i] - l.chrome[i], ends = rowEnds(l, i)
    const down = Math.max(0, ...ends.filter((e) => e <= room + 0.5))
    const up = Math.min(Infinity, ...ends.filter((e) => e > room + 0.5 && l.chrome[i] + e <= l.rest[i]))
    const lift = Math.ceil(up - room - SLACK)
    const end = (!down || l.chrome[i] + down < p.min) && g >= 0 && out[g] - lift >= l.ps[g].min ? up : down
    if (!end || end === Infinity) return
    const d = end === up ? -lift : Math.floor(room - end + SLACK)
    out[i] -= d
    freed += d
  })
  if (g < 0) return out
  // (exactly what's left, as fitPanels gives it: what a drag started from may have been snapped short)
  out[g] = Math.min(tree ? out[g] + freed : l.room - out.reduce((n, h, i) => (i === g ? n : n + h), 0), l.ps[g].content)
  if (tree && out[g] < l.ps[g].content) {
    const room = out[g] - l.chrome[g]
    const end = Math.max(0, ...rowEnds(l, g).filter((e) => e <= room + 0.5))
    if (end) out[g] -= Math.floor(room - end + SLACK)
  }
  return out
}

/** How many rows a panel that draws more keeps when room runs short, its heading's height counting as one. */
const LEAST_ROWS = 4

function measure(body: HTMLElement, s: Sidebars, greedy: Set<string>): Laid {
  const cs = getComputedStyle(body)
  const at = body.clientHeight
  // The room from the body's real height: clientHeight is rounded (838.5px reads 839), and half a pixel too many puts
  // the panels past the bottom, so the sidebar scrolls by it.
  const room = Math.floor(body.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))
  const l: Laid = { keys: [], ps: [], chrome: [], boxes: [], moving: [], rest: [], room, at }
  for (const w of body.children) {
    if (!(w instanceof HTMLElement) || !w.dataset.panel) continue
    const box = w.querySelector<HTMLElement>(":scope > [data-panel-scroll]"), inner = box?.firstElementChild
    if (!box || !inner) continue
    const chrome = w.getBoundingClientRect().height - box.getBoundingClientRect().height
    // A row is as tall as a heading (both follow density).
    const row = inner.querySelector<HTMLElement>("[data-panel-handle]:not([data-sidebar-search])")?.offsetHeight || 28
    const key = w.dataset.panel
    const drawn = chrome + inner.getBoundingClientRect().height, content = Math.ceil(drawn), moving = settling(box)
    l.keys.push(key); l.chrome.push(chrome); l.boxes.push(box); l.moving.push(moving)
    l.rest.push(moving.length ? Math.ceil(drawn + moving.reduce((n, m) => n + m.by, 0) - 0.01) : content)
    l.ps.push({ content, min: Math.ceil(chrome + row * LEAST_ROWS),
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
    const hs = held ?? this.fit(l)
    draw(body, l, hs)
    this.last = { keys: l.keys, hs }
  }

  /** Each panel's height as it'll be once what moves in it settles; one in motion follows what it draws from its last
   *  height, never past where it's going (fitted to it mid-way, it snapped to its end and jumped back). */
  fit(l: Laid): number[] {
    const atRest = l.ps.map((p, i) => ({ ...p, content: l.rest[i] }))
    const to = snapToRows({ ...l, ps: atRest }, fitPanels(atRest, l.room))
    const last = this.last?.keys.join() === l.keys.join() ? this.last.hs : null
    const moving = (i: number) => l.rest[i] !== l.ps[i].content && !l.ps[i].fixed && !l.ps[i].greedy
    if (!last || !l.ps.some((_, i) => moving(i))) return to
    const hs = to.map((t, i) => {
      if (!moving(i)) return t
      const c = l.ps[i].content
      return t >= last[i] ? Math.min(c, t) : Math.max(t, Math.min(c, last[i]))
    })
    // (the greedy one, the tree, takes what's left as they move)
    const g = l.ps.findIndex((p) => p.greedy && !p.fixed)
    if (g >= 0) hs[g] = l.room - hs.reduce((n, h, i) => (i === g ? n : n + h), 0)
    return snapToRows({ ...l, ps: l.ps.map((p, i) => (moving(i) ? { ...p, fixed: true } : p)) }, hs)
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
    // (it settles between two rows when let go; saved without the tree's own snap, the tree needing no height)
    const change = heightsAfterDrag(d.l.ps, d.l.room, snapToRows(d.l, d.now, false))
    if (!change.size) return this.layout()
    const now = snapToRows(d.l, d.now)
    if (this.box.current) draw(this.box.current, d.l, now)
    this.held = { setup: this.setup, hs: now, until: Date.now() + 2000 }
    this.last = { keys: d.l.keys, hs: now }
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
    // And as tabs start moving (a group's rows growing in, after its render was laid out with them at full height: the
    // size the observer saw last may be the same, so it wouldn't say), once they all have.
    let soon = false
    const moved = () => { if (!soon) { soon = true; queueMicrotask(() => { soon = false; fit.layout() }) } }
    body.addEventListener(MOTION, moved)
    return () => { ro.disconnect(); body.removeEventListener(MOTION, moved) }
  }, [on, shape, box, fit])
  return fit
}
