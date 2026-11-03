// Panes springing to new places (a split, a sidebar opened), laid out there at once: each slides from where it was,
// clipped to its size on the way, over its plate (the page's colour). New ones pop in; closing ones shrink away.
import { useLayoutEffect, useRef, type RefObject } from "react"
import { moves, timing } from "@/core/animation"
import { stillCopy } from "@/core/snapshot"
import { floatOrder, getWorkspace, groupOfTab, groups, layoutQuiet, onWorkspaceChange } from "@/core/workspace"
import { layout, leaves, type Rect, type Workspace } from "../../../core/layout.ts"

/** A pane as drawn: its place (shares of the workspace), whether it's a rounded card, and its layer (0: tiled;
 *  above: zoomed or floating, with a z-index of their own). */
export type PaneBox = { id: string; rect: Rect; round?: boolean; layer: number }
const r4 = (n: number) => Math.round(n * 1e4)
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
/** Each pane of `w` as drawn, in the tree's order (moving an element reloads its frames): tiled, zoomed, or floating
 *  (the one focused last on top). */
export function paneBoxes({ root, zoom }: Workspace): PaneBox[] {
  const all = leaves(root), tile = new Map(layout(root).panes.map((p) => [p.group.id, p.rect]))
  const stack = floatOrder(all.filter((g) => g.float).map((g) => g.id))
  return all.map((g) => (g.float ? { id: g.id, rect: g.float, round: true, layer: 2 + stack.indexOf(g.id) }
    : { id: g.id, rect: g.id === zoom ? FULL : tile.get(g.id) ?? FULL, layer: g.id === zoom ? 1 : 0 }))
}
/** The room around and between tiled panes, in px (appearance `paneCards`: index.css' --pane-gap; else 0). */
export const paneGap = (el: Element) => parseFloat(getComputedStyle(el).getPropertyValue("--pane-gap")) || 0
const keyOf = (panes: PaneBox[]) => panes.map((p) => `${p.id}:${r4(p.rect.x)},${r4(p.rect.y)},${r4(p.rect.w)},${r4(p.rect.h)},${p.layer}`).join("|")

type Box = { x: number; y: number; w: number; h: number }
/** Where each pane was (in `box` as it was then: its corner `at`), the one drawn over the others, copies of those going. */
type Snap = { at: { x: number; y: number }; rects: Map<string, Box>; up: string | null; gone: { el: HTMLElement; at: Box; scrolls: [Element, number, number][] }[] }

const ID = "pane-motion"
const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5
const plateOf = (box: HTMLElement, id: string) => box.querySelector<HTMLElement>(`:scope > [data-plate="${CSS.escape(id)}"]`)
const sectionOf = (box: HTMLElement, id: string) => box.querySelector<HTMLElement>(`:scope > [data-group="${CSS.escape(id)}"]`)
const within = (r: DOMRect, b: DOMRect): Box => ({ x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height })

/** Where panes dropped next start from (viewport px: the card dragged), instead of where they are (landFrom). */
const landing = new Map<string, DOMRect>()
/** The next move of pane `id` starts at `rect` (viewport px), where its drag left it; a tab's id: the pane it's in after,
 *  if that's a new one (a tab dropped on an edge). Call it just before the drop. */
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
    probe.style.cssText = "position: fixed; visibility: hidden; pointer-events: none; top: 0; bottom: 0"
    box.after(probe)
    probes.set(box, probe)
  }
  probe.style.left = left
  probe.style.right = right
  return probe.getBoundingClientRect()
}

/** Moves `box`'s panes (`[data-group]`, each with a `[data-plate]`) when their places change, or `area` (the box's
 *  left and right) does; `raise`: the pane drawn over the others while moving (the one the user moved). */
export function usePaneMotion(box: RefObject<HTMLElement | null>, panes: PaneBox[], raise: string, area: string[]) {
  const key = keyOf(panes), edges = area.join("|")
  const snap = useRef<Snap | "quiet" | null>(null)
  const run = useRef(0)
  const drawn = useRef(key)
  const drawnArea = useRef(area)
  // A change that moves panes, before React draws it: where each is on screen now (mid-move too), copies of those going.
  useLayoutEffect(() => onWorkspaceChange(() => {
    const el = box.current
    if (snap.current || keyOf(paneBoxes(getWorkspace())) === drawn.current) return
    if (layoutQuiet() || !moves()) snap.current = "quiet"
    if (!el || snap.current) return
    const b = el.getBoundingClientRect(), ids = new Set(groups().map((g) => g.id)), rects = new Map<string, Box>()
    for (const p of el.querySelectorAll<HTMLElement>(":scope > [data-plate]")) rects.set(p.dataset.plate!, within(p.getBoundingClientRect(), b))
    let up: string | null = null
    for (const [id, r] of landing) {
      const g = groups().some((x) => x.id === id) ? id : !rects.has(groupOfTab(id)?.id ?? "") ? groupOfTab(id)?.id : undefined
      if (g) { rects.set(g, within(r, b)); up ??= g }
    }
    const gone = [...el.querySelectorAll<HTMLElement>(":scope > [data-group]")].filter((s) => !ids.has(s.dataset.group!) && rects.has(s.dataset.group!))
      .map((s) => ({ ...copyOf(s), at: rects.get(s.dataset.group!)! }))
    snap.current = { at: { x: b.left, y: b.top }, rects, up: up ?? el.querySelector<HTMLElement>(":scope > [data-zoomed]")?.dataset.group ?? null, gone }
  }), [box])
  useLayoutEffect(() => {
    const el = box.current, was = drawnArea.current
    let s = snap.current
    snap.current = null
    landing.clear()
    drawnArea.current = area
    const moved = was.join("|") !== edges
    if (!el || (drawn.current === key && !moved)) return
    drawn.current = key
    // (a pane still on its way: how far its plate is from its place, to start the next move from there)
    const midway = new Map<string, DOMMatrixReadOnly>()
    if (moved && !s) for (const p of el.querySelectorAll<HTMLElement>(":scope > [data-plate][data-moving]")) midway.set(p.dataset.plate!, new DOMMatrixReadOnly(getComputedStyle(p).transform))
    for (const a of el.getAnimations({ subtree: true })) if (a.id === ID) a.cancel()
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
    for (const a of ["data-group", "data-pane", "data-pane-body", "data-tab-bar", "data-kept", "data-tab-id", "data-pane-handle", "data-stack"]) x.removeAttribute(a)
  }
  el.inert = true
  el.removeAttribute("aria-label")
  el.setAttribute("aria-hidden", "true")
  el.dataset.paneGone = ""
  return { el, scrolls }
}

