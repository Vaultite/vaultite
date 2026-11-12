// Panes springing to new places (a split, a sidebar opened), laid out there at once: each slides from where it was,
// clipped to its size on the way, over its plate (the page's colour). New ones pop in; closing ones shrink away.
import { useLayoutEffect, useRef, type RefObject } from "react"
import { moves, timing } from "@/core/animation"
import { stillCopy } from "@/core/snapshot"
import { activeTab, floatOrder, layoutQuiet, onWorkspaceChange } from "@/core/workspace"
import { layout, leaves, placesOf, type Rect, type Tab } from "../../../core/layout.ts"

/** A pane as drawn: its place (shares of the workspace), whether it's a rounded card, and its layer (0: tiled;
 *  above: zoomed or floating, with a z-index of their own). */
export type PaneBox = { id: string; rect: Rect; round?: boolean; layer: number }
const r4 = (n: number) => Math.round(n * 1e4)
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
/** Each pane of tab `t` as drawn, in the tree's order: tiled, zoomed, or floating (the one focused last on top). */
export function paneBoxes({ root, zoom }: Tab): PaneBox[] {
  const all = leaves(root), tile = new Map(layout(root).panes.map((p) => [p.pane.id, p.rect]))
  const stack = floatOrder(all.filter((p) => p.float).map((p) => p.id))
  return all.map((p) => (p.float ? { id: p.id, rect: p.float, round: true, layer: 2 + stack.indexOf(p.id) }
    : { id: p.id, rect: p.id === zoom ? FULL : tile.get(p.id) ?? FULL, layer: p.id === zoom ? 1 : 0 }))
}
/** The room around and between tiled panes, in px (appearance `paneCards`: index.css' --pane-gap; else 0). */
export const paneGap = (el: Element) => parseFloat(getComputedStyle(el).getPropertyValue("--pane-gap")) || 0
const keyOf = (panes: PaneBox[]) => panes.map((p) => `${p.id}:${r4(p.rect.x)},${r4(p.rect.y)},${r4(p.rect.w)},${r4(p.rect.h)},${p.layer}`).join("|")

type Box = { x: number; y: number; w: number; h: number }
/** Where each pane was (in `box` as it was then: its corner `at`), the one drawn over the others, copies of those going,
 *  the ones showing another of their tabs, and how far down each one's body was (under its bar, if it had one). */
type Snap = { at: { x: number; y: number }; rects: Map<string, Box>; up: string | null; gone: { el: HTMLElement; at: Box; scrolls: [Element, number, number][] }[]; swapped?: Set<string>; tops?: Map<string, number> }

const ID = "pane-motion"
const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
const plateOf = (box: HTMLElement, id: string) => box.querySelector<HTMLElement>(`:scope > [data-plate="${CSS.escape(id)}"]`)
const sectionOf = (box: HTMLElement, id: string) => box.querySelector<HTMLElement>(`:scope > [data-pane-frame="${CSS.escape(id)}"]`)
const bodyOf = (sec: HTMLElement) => sec.querySelector<HTMLElement>(":scope > [data-pane-body]")
const within = (r: DOMRect, b: DOMRect): Box => ({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height })

/** Where panes dropped next start from (viewport px: the card dragged), instead of where they are (landFrom). */
const landing = new Map<string, DOMRect>()
/** The next move of pane `id` starts at `rect` (viewport px), where its drag left it (a pane, or a tab's pane dropped
 *  on an edge). Call it just before the drop. */
export function landFrom(id: string, rect: DOMRect) { landing.set(id, rect) }

/** A move of panes as it starts: the sections moving, and when they're all still. */
export type PaneMotion = { moving: HTMLElement[]; finished: Promise<unknown> }
const watchers = new Set<(m: PaneMotion) => Promise<unknown> | void>()
/** Hear each move of panes as it starts; a promise back holds it at its start till it settles (at most HOLD_MS): what
 *  a pane shows outside the page (a web page's native view) stands in a picture of itself first. */
export function onPaneMotion(fn: (m: PaneMotion) => Promise<unknown> | void) {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}
const HOLD_MS = 200

/** Where `box` would be with its `left` and `right` as they were: a probe beside it, laid out so. It stays (put in and
 *  taken out each time, it restyled the box's siblings on every move of a sidebar's edge). */
const probes = new WeakMap<HTMLElement, HTMLElement>()
function boxAt(box: HTMLElement, [left, right]: string[]) {
  let probe = probes.get(box)
  if (!probe?.isConnected || probe.previousElementSibling !== box) {
    probe?.remove()
    probe = document.createElement("div")
    probe.setAttribute("aria-hidden", "")
    probe.style.cssText = "position: fixed; visibility: hidden; pointer-events: none"
    box.after(probe)
    probes.set(box, probe)
  }
  // (as tall as the box: under the tab bar, if there's one)
  const b = box.getBoundingClientRect()
  probe.style.top = `${b.top}px`
  probe.style.bottom = `${innerHeight - b.bottom}px`
  probe.style.left = left
  probe.style.right = right
  return probe.getBoundingClientRect()
}

/** Moves `box`'s panes (`[data-pane-frame]`, each over its `[data-plate]`) when their places in tab `tab` or `area` (the
 *  box's left and right) change; `raise`: the one drawn on top (the user moved it). Another tab fades in. */
export function usePaneMotion(box: RefObject<HTMLElement | null>, tab: string, panes: PaneBox[], raise: string, area: string[]) {
  const key = `${tab}|${keyOf(panes)}`, edges = area.join("|")
  const snap = useRef<Snap | "quiet" | "switch" | null>(null)
  const run = useRef(0)
  /** The last move's animations: a pane closed mid-move takes its own out of the box, held paused at its start. */
  const going = useRef<Animation[]>([])
  const drawn = useRef(key)
  const drawnArea = useRef(area)
  /** Each place of the tab as drawn, and the pane it's in: one of a pane's own tabs shown in its stead takes its place
   *  at once, as a browser's tab does (no pane closing, none popping in). */
  const pane = useRef(new Map<string, string>())
  // A change that moves panes, before React draws it: where each is on screen now (mid-move too), copies of those going.
  useLayoutEffect(() => onWorkspaceChange(() => {
    const el = box.current
    const t = activeTab()
    if (snap.current || `${t.id}|${keyOf(paneBoxes(t))}` === drawn.current) return
    if (layoutQuiet() || !moves()) snap.current = "quiet"
    // (another tab: its panes fade in where they are, nothing slides from the last one's places)
    else if (!drawn.current.startsWith(`${t.id}|`)) snap.current = "switch"
    if (!el || snap.current) return
    const b = el.getBoundingClientRect(), ids = new Set(leaves(t.root).map((p) => p.id)), rects = new Map<string, Box>()
    for (const p of el.querySelectorAll<HTMLElement>(":scope > [data-plate]")) rects.set(p.dataset.plate!, within(p.getBoundingClientRect(), b))
    let up: string | null = null
    for (const [id, r] of landing) if (ids.has(id)) { rects.set(id, within(r, b)); up ??= id }
    const instead = new Set<string>(), swapped = new Set<string>()
    for (const p of leaves(t.root)) {
      if (rects.has(p.id)) continue
      // (what it showed now behind it, or the pane it was behind: closed, or shown elsewhere)
      const was = placesOf(p).find((x) => x.id !== p.id && rects.has(x.id) && !ids.has(x.id))?.id ?? pane.current.get(p.id)
      if (was && was !== p.id && rects.has(was) && !ids.has(was)) { rects.set(p.id, rects.get(was)!); instead.add(was); swapped.add(p.id) }
    }
    // (one leaving the tab on screen, closed or to another tab kept drawn hidden: a copy of it goes)
    const gone = [...el.querySelectorAll<HTMLElement>(":scope > [data-pane-frame]:not([data-away])")].filter((s) => !ids.has(s.dataset.paneFrame!) && rects.has(s.dataset.paneFrame!) && !instead.has(s.dataset.paneFrame!))
      .map((s) => ({ ...copyOf(s), at: rects.get(s.dataset.paneFrame!)! }))
    const tops = new Map<string, number>()
    for (const sec of el.querySelectorAll<HTMLElement>(":scope > [data-pane-frame]:not([data-away])")) { const body = bodyOf(sec); if (body) tops.set(sec.dataset.paneFrame!, body.offsetTop) }
    snap.current = { at: { x: b.left, y: b.top }, rects, up: up ?? el.querySelector<HTMLElement>(":scope > [data-zoomed]")?.dataset.paneFrame ?? null, gone, swapped, tops }
  }), [box])
  useLayoutEffect(() => {
    const el = box.current, was = drawnArea.current
    let s = snap.current
    snap.current = null
    landing.clear()
    const shown = activeTab()
    pane.current = new Map(shown ? leaves(shown.root).flatMap((p) => placesOf(p).map((x) => [x.id, p.id] as const)) : [])
    drawnArea.current = area
    const moved = was.join("|") !== edges
    if (!el || (drawn.current === key && !moved)) return
    drawn.current = key
    // (a pane still on its way: how far its plate is from its place, to start the next move from there)
    const midway = new Map<string, DOMMatrixReadOnly>()
    if (moved && !s) for (const p of el.querySelectorAll<HTMLElement>(":scope > [data-plate][data-moving]")) midway.set(p.dataset.plate!, new DOMMatrixReadOnly(getComputedStyle(p).transform))
    // (each cancelled, or its move's `finished` never settles and a web page waits for it off the window)
    for (const a of going.current) a.cancel()
    going.current = []
    for (const m of el.querySelectorAll<HTMLElement>(":scope > [data-moving]")) delete m.dataset.moving
    const t = timing("spring")
    // (the shell taking its places as the vault's state comes in: main.tsx' data-arriving)
    if (!t.duration || "arriving" in document.body.dataset) return
    const b = el.getBoundingClientRect(), g = paneGap(el)
    // Only the area moved: each pane was where it is in the area as it was.
    if (!s && moved) {
      const o = boxAt(el, was), rects = new Map<string, Box>()
      for (const p of panes) {
        const gap = p.round ? 0 : g, W = o.width - gap, H = o.height - gap, m = midway.get(p.id) ?? new DOMMatrixReadOnly()
        const w = p.rect.w * W - gap, h = p.rect.h * H - gap
        rects.set(p.id, { x: o.left - b.left + p.rect.x * W + gap + m.m41, y: o.top - b.top + p.rect.y * H + gap + m.m42, w: w * m.a, h: h * m.d })
      }
      s = { at: { x: b.left, y: b.top }, rects, up: null, gone: [] }
    }
    if (s === "switch") {
      for (const p of panes) { const sec = sectionOf(el, p.id); if (sec) fadeIn(sec, going.current) }
      return
    }
    if (!s || s === "quiet") return
    const mine = ++run.current, moving: HTMLElement[] = [], anims: Animation[] = []
    // (from where the box was then: a sidebar may have moved it meanwhile)
    const ox = s.at.x - b.left, oy = s.at.y - b.top, shift = (r: Box) => ({ x: r.x + ox, y: r.y + oy, w: r.w, h: r.h })
    // (tiled panes as cards: inset by the gap, rounded as floating ones are; Workspace's tile())
    const cards = g > 0
    for (const p of panes) {
      const sec = sectionOf(el, p.id), plate = plateOf(el, p.id)
      if (!sec || !plate) continue
      const gap = p.round ? 0 : g, W = b.width - gap, H = b.height - gap
      const to = { x: p.rect.x * W + gap, y: p.rect.y * H + gap, w: p.rect.w * W - gap, h: p.rect.h * H - gap }
      const then = s.rects.get(p.id), from = then && shift(then)
      // A new pane pops in at its place (Rex's split): from a little smaller and clear, over the one making room.
      if (!from) {
        anims.push(sec.animate([{ transform: "scale(0.92)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { ...timing("fast"), id: ID }))
        sec.dataset.moving = "up"
        moving.push(sec)
        continue
      }
      // (one of a pane's own tabs shown in its stead: what it shows fades in, its bar stays put)
      if (s.swapped?.has(p.id)) { fadeIn(bodyOf(sec) ?? sec, anims); continue }
      // (its bar come or gone, split or back to one pane: what it shows slides to its new top, the bar fading in)
      const body = bodyOf(sec), top = s.tops?.get(p.id)
      if (body && top !== undefined && Math.abs(body.offsetTop - top) > 0.5) {
        anims.push(body.animate([{ transform: `translateY(${top - body.offsetTop}px)` }, { transform: "translateY(0px)" }], { ...t, id: ID }))
        const bar = sec.querySelector<HTMLElement>(":scope > [data-pane-bar]")
        if (bar && body.offsetTop > top) fadeIn(bar, anims)
      }
      if (near(from, to) || to.w < 1 || to.h < 1) continue
      const dx = from.x - to.x, dy = from.y - to.y, round = p.round || cards ? " round 10px" : ""
      anims.push(sec.animate([
        { transform: `translate(${dx}px, ${dy}px)`, clipPath: `inset(0px ${Math.max(0, to.w - from.w)}px ${Math.max(0, to.h - from.h)}px 0px${round})` },
        { transform: "translate(0px, 0px)", clipPath: `inset(0px 0px 0px 0px${round})` },
      ], { ...t, id: ID }))
      anims.push(plate.animate([
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${from.w / to.w}, ${from.h / to.h})` },
        { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1, 1)" },
      ], { ...t, id: ID }))
      // (index.css: shown, and stacked only while moving, as at rest a tiled pane makes no stacking context)
      plate.dataset.moving = sec.dataset.moving = p.id === raise || p.id === s.up ? "up" : ""
      moving.push(plate, sec)
    }
    for (const g of s.gone) {
      const at = shift(g.at)
      Object.assign(g.el.style, { position: "absolute", left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px`, zIndex: "0", pointerEvents: "none" })
      el.prepend(g.el)
      for (const [x, top, left] of g.scrolls) { x.scrollTop = top; x.scrollLeft = left }
      // (Rex's close: it shrinks toward its middle as it fades, quicker than the survivor springs over it)
      const a = g.el.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], { ...timing("fast"), id: ID })
      void a.finished.catch(() => {}).finally(() => g.el.remove())
      anims.push(a)
    }
    going.current = anims
    const finished = Promise.allSettled(anims.map((a) => a.finished))
    void finished.then(() => {
      if (run.current !== mine) return
      for (const m of moving) delete m.dataset.moving
    })
    const holds = [...watchers].map((f) => f({ moving: moving.filter((m) => m.matches("section")), finished })).filter((h) => !!h)
    if (!holds.length) return
    for (const a of anims) a.pause()
    void Promise.race([Promise.allSettled(holds), new Promise((ok) => setTimeout(ok, HOLD_MS))]).then(() => {
      if (run.current === mine) for (const a of anims) if (a.playState === "paused") a.play()
    })
  })
}

/** What comes on screen in place (another tab, a pane's other tab) fades in, short and without moving: a web page's
 *  native view over it can't follow a move. */
function fadeIn(el: HTMLElement, into?: Animation[]) {
  const t = timing("fast")
  if (!t.duration) return
  const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, id: ID })
  into?.push(a)
}

/** A still copy of a closing pane: nothing in it runs or loads (frames, players), nothing finds it as a pane, and its
 *  scrollers keep their places (`scrolls`: [its copy, top, left]). */
function copyOf(sec: HTMLElement) {
  const scrolls: [Element, number, number][] = []
  const el = sec.cloneNode(true) as HTMLElement
  stillCopy(sec, el, (o, c) => { if (o.scrollTop || o.scrollLeft) scrolls.push([c, o.scrollTop, o.scrollLeft]) })
  for (const x of el.querySelectorAll("iframe, video, audio, object, embed")) {
    const stand = document.createElement("div")
    stand.className = (x as HTMLElement).className
    stand.style.cssText = (x as HTMLElement).style.cssText
    x.replaceWith(stand)
  }
  for (const x of [el, ...el.querySelectorAll("*")]) {
    x.removeAttribute("id")
    for (const a of ["data-pane-frame", "data-pane", "data-pane-body", "data-pane-bar", "data-kept", "data-tab-body", "data-pane-handle", "data-ui"]) x.removeAttribute(a)
  }
  el.inert = true
  el.removeAttribute("aria-label")
  el.setAttribute("aria-hidden", "true")
  el.dataset.paneGone = ""
  return { el, scrolls }
}

