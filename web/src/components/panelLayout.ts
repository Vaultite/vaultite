import { useLayoutEffect, useState, type RefObject } from "react"
import { dragPanels, fitPanels, heightIn, heightsAfterDrag, type PanelFit, type Sidebars } from "../../../core/sidebars.ts"
import { setPanelHeights, type PanelOf } from "@/core/plugins"
import { MOTION } from "@/core/tabline"
import { rowOffsets } from "@/core/virtual"

type Laid = { keys: string[]; ps: PanelFit[]; chrome: number[]; boxes: HTMLElement[]; moving: Settling[][]; rest: number[]; room: number; at: number }
type Settling = { el: Element; by: number }

function gapAfter(el: Element) {
  let p = el.parentElement
  while (p && getComputedStyle(p).display === "contents") p = p.parentElement
  return p ? parseFloat(getComputedStyle(p).rowGap) || 0 : 0
}

function settling(box: HTMLElement): Settling[] {
  const out: Settling[] = []
  for (const a of box.getAnimations({ subtree: true })) {
    const fx = a.effect as KeyframeEffect | null, el = fx?.target, end = fx?.getKeyframes().at(-1)
    if (!el || !end || end.height == null || a.playState === "finished") continue
    // Layout keeps lengths in 1/64px, truncated; computed values mid-animation are finer.
    const css = getComputedStyle(el), px = (v: unknown, now: string) => Math.trunc((parseFloat(String(v ?? now)) || 0) * 64) / 64
    const rest = px(end.height, "0") === 0 ? -gapAfter(el)
      : px(end.height, "0") + px(end.marginTop ?? end.marginBlockStart ?? end.marginBlock, css.marginTop) + px(end.marginBottom ?? end.marginBlockEnd ?? end.marginBlock, css.marginBottom)
    const by = rest - (el.getBoundingClientRect().height + px(null, css.marginTop) + px(null, css.marginBottom))
    if (Math.abs(by) > 0.01) out.push({ el, by })
  }
  return out.filter((x) => !out.some((y) => y !== x && y.el.contains(x.el)))
}

function rowEnds(l: Laid, i: number): number[] {
  const box = l.boxes[i], inner = box.firstElementChild, moving = l.moving[i]
  if (!inner) return []
  const top = inner.getBoundingClientRect().top
  const by = (r: Element) => moving.reduce((n, m) => (!m.el.contains(r) && m.el.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING ? n + m.by : n), 0)
  const ends: number[] = [], lists = new Set<HTMLElement>()
  for (const r of inner.querySelectorAll<HTMLElement>("[data-panel-handle], [data-keyrow]")) {
    const list = r.closest("[data-vi]")?.parentElement
    if (list && rowOffsets(list)) { lists.add(list); continue }
    if (moving.some((m) => m.el.contains(r) && m.by < -(m.el.getBoundingClientRect().height - 0.5))) continue
    const from = r.hasAttribute("data-panel-handle") && getComputedStyle(r).position === "sticky" ? box.getBoundingClientRect().top : top
    ends.push(r.getBoundingClientRect().bottom - from + by(r))
  }
  for (const list of lists) {
    const o = rowOffsets(list)!, at = list.getBoundingClientRect().top - top + by(list)
    const row = list.querySelector(":scope > [data-vi]"), button = row?.querySelector("[data-keyrow]")
    const gap = row && button ? row.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom : 0
    for (let k = 1; k < o.length; k++) { ends.push(at + o[k] - gap); if (at + o[k] - gap > l.room) break }
  }
  return ends
}

const SLACK = 0.25

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
    const end = !down || l.chrome[i] + down < p.min ? (g >= 0 && out[g] - lift >= l.ps[g].min ? up : 0) : down
    if (!end || end === Infinity) return
    const d = end === up ? -lift : Math.floor(room - end + SLACK)
    out[i] -= d
    freed += d
  })
  if (g < 0) return out
  out[g] = Math.min(tree ? out[g] + freed : l.room - out.reduce((n, h, i) => (i === g ? n : n + h), 0), l.ps[g].content)
  if (tree && out[g] < l.ps[g].content) {
    const room = out[g] - l.chrome[g]
    const end = Math.max(0, ...rowEnds(l, g).filter((e) => e <= room + 0.5))
    if (end) out[g] -= Math.floor(room - end + SLACK)
  }
  return out
}

const LEAST_ROWS = 4

function measure(body: HTMLElement, s: Sidebars, greedy: Set<string>): Laid {
  const cs = getComputedStyle(body)
  const at = body.clientHeight
  // clientHeight rounds (838.5px reads 839): half a pixel too many and the sidebar scrolls.
  const room = Math.floor(body.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))
  const l: Laid = { keys: [], ps: [], chrome: [], boxes: [], moving: [], rest: [], room, at }
  for (const w of body.children) {
    if (!(w instanceof HTMLElement) || !w.dataset.panel) continue
    const box = w.querySelector<HTMLElement>(":scope > [data-panel-scroll]"), inner = box?.firstElementChild
    if (!box || !inner) continue
    const chrome = w.getBoundingClientRect().height - box.getBoundingClientRect().height
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

function draw(body: HTMLElement, l: Laid, hs: number[]) {
  l.boxes.forEach((b, i) => {
    const v = l.ps[i].fixed ? "" : `${Math.max(0, hs[i] - l.chrome[i])}px`
    if (b.style.height !== v) b.style.height = v
  })
  body.toggleAttribute("data-overflow", hs.reduce((n, h) => n + h, 0) > l.room)
}

class PanelLayout {
  on = false
  setup: Sidebars | null = null
  greedy = new Set<string>()
  drag: null | { l: Laid; i: number; y: number; start: number[]; now?: number[] } = null
  held: null | { setup: Sidebars; hs: number[]; until: number } = null
  last: null | { keys: string[]; hs: number[] } = null
  box: RefObject<HTMLDivElement | null>
  constructor(box: RefObject<HTMLDivElement | null>) { this.box = box }

  update(on: boolean, setup: Sidebars, panels: PanelOf[]) {
    if (this.on && !on) {
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
    const g = l.ps.findIndex((p) => p.greedy && !p.fixed)
    if (g >= 0) hs[g] = l.room - hs.reduce((n, h, i) => (i === g ? n : n + h), 0)
    return snapToRows({ ...l, ps: l.ps.map((p, i) => (moving(i) ? { ...p, fixed: true } : p)) }, hs)
  }

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

  end = () => {
    const d = this.drag
    this.drag = null
    if (!d?.now || !this.setup) return
    const change = heightsAfterDrag(d.l.ps, d.l.room, snapToRows(d.l, d.now, false))
    if (!change.size) return this.layout()
    const now = snapToRows(d.l, d.now)
    if (this.box.current) draw(this.box.current, d.l, now)
    this.held = { setup: this.setup, hs: now, until: Date.now() + 2000 }
    this.last = { keys: d.l.keys, hs: now }
    setPanelHeights(Object.fromEntries([...change].map(([j, px]) => [d.l.keys[j], px])), d.l.at)
  }
}

export function usePanelLayout(box: RefObject<HTMLDivElement | null>, on: boolean, setup: Sidebars, panels: PanelOf[]) {
  const [fit] = useState(() => new PanelLayout(box))
  useLayoutEffect(() => {
    fit.update(on, setup, panels)
    fit.layout()
  })
  const shape = `${panels.map((p) => p.key).join()}|${setup.collapsed.join()}`
  useLayoutEffect(() => {
    const body = box.current
    if (!on || !body) return
    const ro = new ResizeObserver(() => fit.layout())
    ro.observe(body)
    for (const el of body.querySelectorAll(":scope > [data-panel] > [data-panel-scroll] > [data-panel-content]")) ro.observe(el)
    // ResizeObserver stays quiet when a size matches the last it saw, as when a group's rows start growing in.
    let soon = false
    const moved = () => { if (!soon) { soon = true; queueMicrotask(() => { soon = false; fit.layout() }) } }
    body.addEventListener(MOTION, moved)
    return () => { ro.disconnect(); body.removeEventListener(MOTION, moved) }
  }, [on, shape, box, fit])
  return fit
}
