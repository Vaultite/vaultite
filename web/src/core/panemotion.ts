// Panes springing to new places, laid out there at once (a page reflows once, not per frame): each slides from where it
// was, clipped to its size on the way, over its plate (the page's colour). New ones pop in; closing ones shrink away.
import { useLayoutEffect, useRef, type RefObject } from "react"
import { moves, timing } from "@/core/animation"
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
const keyOf = (panes: PaneBox[]) => panes.map((p) => `${p.id}:${r4(p.rect.x)},${r4(p.rect.y)},${r4(p.rect.w)},${r4(p.rect.h)},${p.layer}`).join("|")

type Box = { x: number; y: number; w: number; h: number }
type Snap = { rects: Map<string, Box>; up: string | null; gone: { el: HTMLElement; at: Box; scrolls: [number, number, number][] }[] }

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

/** Moves `box`'s panes (`[data-group]`, each with a `[data-plate]`) when their places change; `raise`: the pane drawn
 *  over the others while moving (the one the user moved). */
export function usePaneMotion(box: RefObject<HTMLDivElement | null>, panes: PaneBox[], raise: string) {
  const key = keyOf(panes)
  const snap = useRef<Snap | "quiet" | null>(null)
  const run = useRef(0)
  const drawn = useRef(key)
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
    snap.current = { rects, up: up ?? el.querySelector<HTMLElement>(":scope > [data-zoomed]")?.dataset.group ?? null, gone }
  }), [box])
  useLayoutEffect(() => {
    const el = box.current, s = snap.current
    snap.current = null
    landing.clear()
    if (!el || drawn.current === key) return
    drawn.current = key
    for (const a of el.getAnimations({ subtree: true })) if (a.id === ID) a.cancel()
    for (const m of el.querySelectorAll<HTMLElement>(":scope > [data-moving]")) delete m.dataset.moving
    const t = timing("spring")
    if (!s || s === "quiet" || !t.duration) return
    const b = el.getBoundingClientRect(), mine = ++run.current, moving: HTMLElement[] = [], anims: Animation[] = []
    for (const p of panes) {
      const sec = sectionOf(el, p.id), plate = plateOf(el, p.id)
      if (!sec || !plate) continue
      const to = { x: p.rect.x * b.width, y: p.rect.y * b.height, w: p.rect.w * b.width, h: p.rect.h * b.height }
      const from = s.rects.get(p.id)
      // A new pane pops in at its place (Rex's split): from a little smaller and clear, over the one making room.
      if (!from) {
        anims.push(sec.animate([{ transform: "scale(0.92)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { ...timing("fast"), id: ID }))
        sec.dataset.moving = "up"
        moving.push(sec)
        continue
      }
      if (near(from, to) || to.w < 1 || to.h < 1) continue
      const dx = from.x - to.x, dy = from.y - to.y, round = p.round ? " round 10px" : ""
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
      Object.assign(g.el.style, { position: "absolute", left: `${g.at.x}px`, top: `${g.at.y}px`, width: `${g.at.w}px`, height: `${g.at.h}px`, zIndex: "0", pointerEvents: "none" })
      el.prepend(g.el)
      const all = g.el.querySelectorAll("*")
      for (const [i, top, left] of g.scrolls) { const x = all[i]; if (x) { x.scrollTop = top; x.scrollLeft = left } }
      // (Rex's close: it shrinks toward its middle as it fades, quicker than the survivor springs over it)
      const a = g.el.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.92)" }], { ...timing("fast"), id: ID })
      void a.finished.catch(() => {}).finally(() => g.el.remove())
      anims.push(a)
    }
    void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
      if (run.current !== mine) return
      for (const m of moving) delete m.dataset.moving
    })
  })
}

/** A still copy of a closing pane: nothing in it runs or loads (frames, players), nothing finds it as a pane, and its
 *  scrollers keep their places (`scrolls`: [index among its elements, top, left]). */
function copyOf(sec: HTMLElement) {
  const scrolls: [number, number, number][] = []
  sec.querySelectorAll("*").forEach((x, i) => { if (x.scrollTop || x.scrollLeft) scrolls.push([i, x.scrollTop, x.scrollLeft]) })
  const el = sec.cloneNode(true) as HTMLElement
  const olds = sec.querySelectorAll("canvas")
  // (a WebGL one, a terminal's, copies empty: its picture is gone once drawn, and keeping it would cost every frame)
  el.querySelectorAll("canvas").forEach((c, i) => {
    try { c.getContext("2d")?.drawImage(olds[i], 0, 0) } catch { /* tainted */ }
  })
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

