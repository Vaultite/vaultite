// Pointer events, not HTML5 drag and drop: that loses events over frames and differs in Safari and Electron.
import { useEffect, useRef } from "react"
import { noteActivity } from "@/core/activity"
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { isMac } from "@/core/platform"
import { scrollerOf } from "@/core/near"
import { signal } from "@/core/signal"
import { elementOf, htmlOf } from "@/core/dom"

export type DragItem = {
  /** Where it comes from ("row": a database view's file, a board's card or a calendar's item; with `to`, a panel's row
   *  that opens something, like a terminal in the Terminals panel). */
  from: "tab" | "pane" | "group" | "tree" | "pin" | "panel" | "row" | "newtab" | "status" | "block" | "table" | "column" | "container" | "site" | "bookmark"
  /** What it opens in a tab ("file:Notes/Idea.md", "view:terminal/abc", "settings"); none for a folder. */
  to?: string
  /** The tab it is (dropping it moves that tab, all its panes); otherwise a drop opens a new one. */
  tab?: string
  /** The vault file or folder it is. */
  path?: string
  /** Several selected together (core/select.ts), `path` the one held: the tree's files and folders, pinned pages. */
  paths?: string[]
  /** What those several open, in order (`to` is the held one's): each a tab of its own. */
  tos?: string[]
  /** Several tabs selected together, `tab` the one held. */
  tabs?: string[]
  folder?: boolean
  /** A pane, by id (dragged by its bar, or a half of a split tab's row). */
  pane?: string
  /** That pane's place alone, one of its own tabs (a row of its list in the Tabs panel, a chip of its strip): it moves
   *  without the others stacked with it. */
  place?: boolean
  /** A tab group, by id: its tabs go together. */
  group?: string
  /** A sidebar panel's key ("terminal:sessions"), and what the dragged item shows (its title). */
  panel?: string
  label?: string
  /** A blank tab's section or button (by its heading; a button itself), reordered on the page (NewTab.tsx). */
  newtab?: { list: "sections" | "actions"; key: string }
  /** A status bar's ambient item, by key ("inbox:new"), moved along the bar or into its tray (StatusBar.tsx). */
  status?: string
  /** A block of a page being edited, by name (its card moved: a dashboard's grid). */
  block?: string
  /** A row or column of a table drawn in the editor: which table (editor/tables.ts), which reorders it. */
  table?: string
  /** A browser container, by id, reordered in the Sites tab (web-viewer/Sites.tsx). */
  container?: string
  /** A bookmark, by address, moved along the Browser's bookmarks bar or into one of its folders (web-viewer/BookmarksBar.tsx). */
  bookmark?: string
  /** A site's login in Sites (web-viewer/Sites.tsx), by its set of logins (a profile) and site: moved to another set,
   *  or reordered in its own. */
  site?: { logins: string; site: string }
  /** A database view's column, by key, moved along its table's header (`table`: which table). */
  column?: { table: string; key: string }
  /** Its source draws its own picture of it following the pointer (a phone's tab card, lifted whole): no DragGhost. */
  drawn?: boolean
  /** Dragged in another of the app's windows and held over this one (a pop-out's tab: core/windows.ts): that window
   *  draws it, this one only where it would land. */
  elsewhere?: boolean
}
type Answer = { data: unknown; hint?: string; weak?: boolean; stay?: boolean; drop: (item: DragItem) => void }
type Hit = Answer & { target: string }
export type DropId<H> = string & { readonly hit?: H }
export const hitOn = <H,>(hit: Hit | null | undefined, id: DropId<H>): H | null => (hit?.target === id ? hit.data as H : null)
export type Drag = { item: DragItem; x: number; y: number; hit: Hit | null; finger?: boolean; origin?: Origin }
export type Origin = { x: number; y: number; rect: DOMRect }

let drag: Drag | null = null
const subs = signal()
const setDrag = (d: Drag | null) => { drag = d; subs.notify() }
export const getDrag = () => drag
/** The drag, drawn again on every move; with `pick`, only when what it picks changes (`(d) => d?.item`: once a drag).
 *  Most need only the item: a move redrawing a pane's whole page (its hit) cost ~140 components a frame. */
export function useDrag(): Drag | null
export function useDrag<T>(pick: (d: Drag | null) => T): T
export function useDrag<T>(pick?: (d: Drag | null) => T) { return subs.use(() => (pick ? pick(drag) : drag)) }
export const useDragItem = () => subs.use(() => drag?.item ?? null)
export const useDragging = () => subs.use(() => !!drag)
export const onDrag = (fn: () => void) => subs.subscribe(fn)
export type DragEnd = { item: DragItem; x: number; y: number; origin?: Origin; dropped: boolean; away: boolean }
const ends = new Set<(e: DragEnd) => void>()
export const onDragEnd = (fn: (e: DragEnd) => void) => { ends.add(fn); return () => { ends.delete(fn) } }

let fingerHolds = false
export const fingerHolding = () => fingerHolds
// The page mustn't scroll under a finger holding something: WebKit only lets a touchmove stop a begun scroll if a
// cancelable listener was there all along (as dnd-kit does).
if (typeof window !== "undefined") addEventListener("touchmove", (e) => { if (fingerHolds && e.cancelable) e.preventDefault() }, { passive: false })

if (typeof window !== "undefined") {
  const captured = new Set<number>(), root = document.documentElement
  addEventListener("gotpointercapture", (e) => { if (e.pointerType !== "touch") { captured.add(e.pointerId); root.toggleAttribute("data-captured", true) } }, true)
  addEventListener("lostpointercapture", (e) => { if (captured.delete(e.pointerId) && !captured.size) root.removeAttribute("data-captured") }, true)
}

export type DropTarget<H> = {
  at: (item: DragItem, x: number, y: number, el: Element | null) => { data: H; hint?: string; weak?: boolean; stay?: boolean } | null
  drop: (item: DragItem, data: H) => void
  end?: () => void
}
type Registered = { at: (item: DragItem, x: number, y: number, el: Element | null) => Answer | null; end?: () => void }
const targets = new Map<string, Registered>()

export function addDropTarget<H>(id: DropId<H>, t: DropTarget<H>) {
  const target: Registered = {
    at: (item, x, y, el) => { const a = t.at(item, x, y, el); return a && { ...a, drop: (it) => t.drop(it, a.data) } },
    end: t.end,
  }
  targets.set(id, target)
  return () => { if (targets.get(id) === target) targets.delete(id) }
}

/** Take drops while mounted. `at` answers what a drop at (x, y) would do (`hint`: a word on the item, like "Unpin";
 *  `weak`: taken only when no other target answers; `stay`: where it is already, a Hit's); `drop` does it. */
export function useDropTarget<H>(id: DropId<H>, at: (item: DragItem, x: number, y: number, el: Element | null) => H | null,
  drop: (item: DragItem, hit: H) => void, opts: { hint?: (hit: H) => string | undefined; weak?: (hit: H) => boolean; stay?: (hit: H) => boolean; end?: () => void } = {}) {
  const ref = useRef({ at, drop, opts })
  useEffect(() => { ref.current = { at, drop, opts } })
  useEffect(() => {
    targets.set(id, {
      at: (item, x, y, el) => {
        const h = ref.current.at(item, x, y, el)
        return h === null ? null : { data: h, hint: ref.current.opts.hint?.(h), weak: ref.current.opts.weak?.(h), stay: ref.current.opts.stay?.(h), drop: (it) => ref.current.drop(it, h) }
      },
      end: () => ref.current.opts.end?.(),
    })
    return () => { targets.delete(id) }
  }, [id])
}

/** Where an element is laid out, without the slide a drag's preview gives it (core/slide.ts): hits are worked out on
 *  that, so what makes way doesn't move what's under the pointer. */
export function laidOut(el: Element) {
  const r = el.getBoundingClientRect(), slid = el.closest<HTMLElement>("[data-slide]")
  if (!slid?.style.transform) return r
  const m = new DOMMatrixReadOnly(getComputedStyle(slid).transform)
  return new DOMRect(r.x - m.m41, r.y - m.m42, r.width, r.height)
}

/** Whether a drag at (x, y) over `el` is just past a list's `last` row, where a drop puts it at the end: under it, down
 *  to its panel's bottom or a row's height (a panel often ends right under it), and not on another list's row or panel. */
export function pastEnd(list: Element, last: Element, x: number, y: number, el: Element | null) {
  const box = list.getBoundingClientRect(), row = laidOut(last)
  const panel = list.closest("[data-panel]"), below = el?.closest("[data-panel]")
  const bottom = Math.max(row.bottom + row.height, panel?.getBoundingClientRect().bottom ?? 0)
  return x >= box.left && x <= box.right && y >= row.bottom && y < bottom
    && (!el || list.contains(el) || (!el.closest("[data-keyrow]") && (!below || below === panel)))
}

/** Whether a drag at (x, y) over `el` is just above a list's `first` row (its panel's heading), where a drop puts it
 *  first: up to a row's height above it, and not on another list's row or panel. */
export function beforeStart(list: Element, first: Element, x: number, y: number, el: Element | null) {
  const box = list.getBoundingClientRect(), row = laidOut(first)
  const panel = list.closest("[data-panel]"), over = el?.closest("[data-panel]")
  return x >= box.left && x <= box.right && y < row.top && y >= row.top - row.height
    && (!el || list.contains(el) || (!el.closest("[data-keyrow]") && (!over || over === panel)))
}

const scrolled = new WeakMap<Element, number>()

/** Scrolls a box while a drag holds the pointer near its edge, faster the closer: `near` on every move, `stop` when the
 *  pointer leaves or the drag ends. `alive`: whether to go on (default: while something is dragged). */
export function edgeScroller(axis: "x" | "y" = "y") {
  let speed = 0, frame = 0, scrolling: HTMLElement | null = null
  const stop = () => { speed = 0 }
  const near = (box: HTMLElement, at: number, alive: () => boolean = () => !!drag) => {
    scrolling = box
    const b = box === document.scrollingElement
      ? { top: document.querySelector("[data-phone-header]")?.getBoundingClientRect().bottom ?? 0, bottom: document.querySelector("[data-phone-bar]")?.getBoundingClientRect().top ?? innerHeight, left: 0, right: innerWidth }
      : box.getBoundingClientRect()
    const [lo, hi] = axis === "x" ? [b.left, b.right] : [b.top, b.bottom]
    const zone = Math.min(drag?.finger ? 48 : 24, (hi - lo) / 6)
    const d = at < lo + zone ? at - (lo + zone) : at > hi - zone ? at - (hi - zone) : 0
    speed = Math.max(-14, Math.min(14, Math.round(d / 2)))
    if (!speed || frame) return
    const step = (t: number) => {
      const el = scrolling
      if (!speed || !el || !alive()) { frame = 0; return }
      if (scrolled.get(el) !== t) {
        scrolled.set(el, t)
        if (axis === "x") el.scrollLeft += speed
        else el.scrollTop += speed
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }
  const over = (list: Element, x: number, y: number) => {
    const page = htmlOf(document.scrollingElement)
    const box = axis === "x" ? htmlOf(list) : scrollerOf(list, true) ?? (page && page.scrollHeight > page.clientHeight ? page : null)
    if (!box || (axis === "x" && box.scrollWidth <= box.clientWidth)) return stop()
    if (box === page) return near(box, y)
    const b = box.getBoundingClientRect()
    const [at, lo, hi, across, from, to] = axis === "x" ? [x, b.left, b.right, y, b.top, b.bottom] : [y, b.top, b.bottom, x, b.left, b.right]
    const past = axis === "x" ? 48 : 0
    if (across < from || across > to || at < lo - past || at > hi + past) stop()
    else near(box, at)
  }
  return { near, over, stop }
}

/** Ask the targets again what a drop where the pointer rests would do: for an answer that changes with time while the
 *  pointer is still (a card held over another groups them after a moment: TabSwitcher). */
export function rehit() { if (drag) setDrag({ ...drag, hit: hitAt(drag.item, drag.x, drag.y, drag.item.elsewhere ? takesElsewhere : undefined) }) }

/** What a drop on this target would do right now, while something is dragged over it: the same object while the answer
 *  is (targets answer anew on every move), so it's drawn again only when that changes. */
export function useDropHit<H>(id: DropId<H>): H | null {
  const last = useRef<{ raw: H | null; key: string; data: H | null }>({ raw: null, key: "null", data: null })
  return subs.use(() => {
    const raw = hitOn(drag?.hit, id)
    const l = last.current
    if (raw !== l.raw) {
      const key = raw == null ? "null" : JSON.stringify(raw)
      last.current = key === l.key ? { ...l, raw } : { raw, key, data: raw }
    }
    return last.current.data
  })
}

function hitAt(item: DragItem, x: number, y: number, takes?: (target: string) => boolean): Hit | null {
  const el = document.elementFromPoint(x, y)
  let hit: Hit | null = null, weak: Hit | null = null
  for (const [id, t] of targets) {
    if (takes && !takes(id)) continue
    const h = t.at(item, x, y, el)
    if (h?.weak) weak ??= { target: id, ...h }
    else if (h) hit ??= { target: id, ...h }
  }
  return hit ?? weak
}

let takesElsewhere: ((target: string) => boolean) | undefined
export function dragElsewhere(item: DragItem | null, x = 0, y = 0, takes?: (target: string) => boolean): Hit | null {
  if (drag && !drag.item.elsewhere) return null
  if (!item) {
    const hit = drag?.hit ?? null
    if (drag) { setDrag(null); for (const t of targets.values()) t.end?.() }
    return hit
  }
  const it = drag?.item.elsewhere && JSON.stringify(drag.item) === JSON.stringify(item) ? drag.item : item
  takesElsewhere = takes
  setDrag({ item: it, x, y, hit: hitAt(it, x, y, takes) })
  return drag!.hit
}

function lift(item: DragItem, finger = false) {
  const root = document.documentElement
  root.dataset.dragging = ""
  getSelection()?.removeAllRanges()
  let frame = 0
  const scrolled = () => { frame ||= requestAnimationFrame(() => { frame = 0; rehit() }) }
  addEventListener("scroll", scrolled, true)
  return (hit: Hit | null | undefined) => {
    removeEventListener("scroll", scrolled, true)
    cancelAnimationFrame(frame)
    delete root.dataset.dragging
    if (hit && finger) haptic("medium")
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
    addEventListener("click", swallow, true)
    setTimeout(() => removeEventListener("click", swallow, true))
    if (hit) { if (targets.has(hit.target)) hit.drop(item); noteDrop(item, hit) }
  }
}

let outside: ((item: DragItem, screen: { x: number; y: number }) => boolean) | null = null
export const setOutsideDrop = (fn: typeof outside) => { outside = fn }
let covered: ((x: number, y: number) => boolean) | null = null
export const setCovered = (fn: typeof covered) => { covered = fn }
export const pastEdge = (x: number, y: number, finger = false) => !finger && (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !!covered?.(x, y))

/** Press on something draggable: a mouse or pen, or a finger where `touch` says a phone has somewhere to drop it (else
 *  a finger scrolls or taps). `data-no-drag` children stay plain buttons. */
export function startDrag(e: React.PointerEvent<HTMLElement> | PointerEvent, item: DragItem, { touch = false }: { touch?: boolean } = {}) {
  // A Mac's Control-click is a right-click.
  if (e.button !== 0 || (isMac && e.ctrlKey) || elementOf(e.target)?.closest("[data-no-drag]")) return
  if (e.pointerType === "touch") { if (touch) pickUp(e, item); return }
  const el = htmlOf(e.currentTarget), x0 = e.clientX, y0 = e.clientY, id = e.pointerId
  if (!el) return
  let end: ReturnType<typeof lift> | null = null, last: PointerEvent | null = null, origin: Origin | undefined
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    last = ev
    if (!end) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      // Captured, so the drag goes on over frames (artifacts, terminals) and outside the window.
      try { el.setPointerCapture(id) } catch { /* already gone */ }
      origin = { x: x0, y: y0, rect: el.getBoundingClientRect() }
      end = lift(item)
    }
    setDrag({ item, x: ev.clientX, y: ev.clientY, hit: covered?.(ev.clientX, ev.clientY) ? null : hitAt(item, ev.clientX, ev.clientY), origin })
  }
  // A link or an image inside would start the browser's own drag.
  const native = (ev: DragEvent) => ev.preventDefault()
  const stop = (drop: boolean) => {
    removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", cancel, true)
    removeEventListener("keydown", key, true); removeEventListener("dragstart", native, true)
    quit()
    const hit = drag?.hit?.stay ? null : drag?.hit
    setDrag(null)
    for (const t of targets.values()) t.end?.()
    const out = !!last && pastEdge(last.clientX, last.clientY)
    const told = (dropped: boolean, away: boolean) => { if (end && last) for (const f of ends) f({ item, x: last.clientX, y: last.clientY, origin, dropped, away }) }
    if (drop && hit) told(true, false)
    end?.(drop ? hit : null)
    if (!(drop && hit)) told(false, !!(drop && end && out && outside?.(item, { x: last!.screenX, y: last!.screenY })))
  }
  const up = (ev: PointerEvent) => { if (ev.pointerId === id) stop(true) }
  const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) stop(false) }
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !end) return
    ev.preventDefault(); ev.stopPropagation()
    stop(false)
    try { el.releasePointerCapture(id) } catch { /* already gone */ }
    const swallow = (c: MouseEvent) => { c.preventDefault(); c.stopPropagation() }
    const done = () => { removeEventListener("pointerup", later, true); removeEventListener("pointerdown", done, true); removeEventListener("click", swallow, true) }
    const later = () => setTimeout(done)
    addEventListener("click", swallow, true); addEventListener("pointerup", later, true); addEventListener("pointerdown", done, true)
  }
  addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", cancel, true)
  addEventListener("keydown", key, true); addEventListener("dragstart", native, true)
  const quit = onAway(() => stop(false))
}

// Touch events, since they go on while the page is held still.
function pickUp(e: React.PointerEvent<HTMLElement> | PointerEvent, item: DragItem) {
  const el = htmlOf(e.currentTarget)
  if (!el) return
  let from = { x: e.clientX, y: e.clientY }, picked = false
  let end: ReturnType<typeof lift> | null = null
  const held = (ev: MouseEvent) => {
    if (picked || !(ev.target instanceof Node) || !el.contains(ev.target)) return
    picked = fingerHolds = true
    from = { x: ev.clientX, y: ev.clientY }
    getSelection()?.removeAllRanges()
  }
  const move = (ev: TouchEvent) => {
    const t = ev.touches[0]
    if (!t) return
    const far = Math.hypot(t.clientX - from.x, t.clientY - from.y) > 10
    if (!picked) { if (far) stop(false); return }
    if (!end) { if (!far) return; end = lift(item, true) }
    setDrag({ item, x: t.clientX, y: t.clientY, hit: hitAt(item, t.clientX, t.clientY), finger: true })
  }
  const stop = (drop: boolean) => {
    removeEventListener("contextmenu", held, true); removeEventListener("touchmove", move, true)
    removeEventListener("touchend", up, true); removeEventListener("touchcancel", cancel, true)
    quit()
    fingerHolds = false
    const hit = drag?.hit?.stay ? null : drag?.hit
    if (drag) setDrag(null)
    for (const t of targets.values()) t.end?.()
    end?.(drop ? hit : null)
  }
  const up = (ev: TouchEvent) => { if (!ev.touches.length) stop(true) }
  const cancel = () => stop(false)
  addEventListener("contextmenu", held, true); addEventListener("touchmove", move, true)
  addEventListener("touchend", up, true); addEventListener("touchcancel", cancel, true)
  const quit = onAway(cancel)
}

const PLACES: Partial<Record<string, string>> = { panes: "a pane", panels: "the sidebar", pins: "Pinned", workspaces: "another workspace", newtab: "its place on the new tab", status: "the status bar" }
function noteDrop(item: DragItem, hit: Hit) {
  const what = item.path || item.label || item.to?.replace(/^(file|view):/, "") || item.from
  const kind = hit.target.split(":")[0]
  const where = PLACES[kind]
    ?? (typeof hit.data === "string" ? hit.data || "the vault's top folder" : kind.replace(/-/g, " "))
  noteActivity("drop", `Dragged ${what} to ${where}`, item.path ? [item.path] : undefined)
}
