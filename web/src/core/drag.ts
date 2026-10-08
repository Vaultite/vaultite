// Dragging: one pointer-events primitive for everything (HTML5 drag and drop loses events over frames and differs in
// Safari and Electron). Targets say whether they'd take the item; the first wins, `weak` ones only when no other does.
import { useEffect, useRef } from "react"
import { noteActivity } from "@/core/activity"
import { onAway } from "@/core/away"
import { haptic } from "@/core/haptics"
import { signal } from "@/core/signal"

export type DragItem = {
  /** Where it comes from ("row": a database view's file, a board's card or a calendar's item; with `to`, a panel's row
   *  that opens something, like a terminal in the Terminals panel). */
  from: "tab" | "group" | "tree" | "pin" | "panel" | "row" | "newtab"
  /** What it opens in a tab ("file:Notes/Idea.md", "view:terminal/abc", "settings"); none for a folder. */
  to?: string
  /** The tab it is (dropping it moves that tab); otherwise a drop opens a new one. */
  tab?: string
  /** The vault file or folder it is. */
  path?: string
  /** Several selected together (core/select.ts), `path` the one held: the tree's files and folders, pinned pages. */
  paths?: string[]
  /** Several tabs selected together, `tab` the one held. */
  tabs?: string[]
  folder?: boolean
  /** A pane: its group's id (all its tabs go together). */
  group?: string
  /** A sidebar panel's key ("terminal:sessions"), and what the dragged item shows (its title; a pane's "3 tabs"). */
  panel?: string
  label?: string
  /** A blank tab's section or button (by its heading; a button itself), reordered on the page (NewTab.tsx). */
  newtab?: { list: "sections" | "actions"; key: string }
  /** Its source draws its own picture of it following the pointer (a phone's tab card, lifted whole): no DragGhost. */
  drawn?: boolean
}
type Hit = { target: string; data: unknown; hint?: string; weak?: boolean }
/** `finger`: a touch drag (its picture goes above the finger, where it can be seen). */
export type Drag = { item: DragItem; x: number; y: number; hit: Hit | null; finger?: boolean }

let drag: Drag | null = null
const subs = signal()
const setDrag = (d: Drag | null) => { drag = d; subs.notify() }
export const getDrag = () => drag
export const useDrag = () => subs.use(() => drag)
/** Whether something is being dragged (redraws only when that changes, not on every move). */
export const useDragging = () => subs.use(() => !!drag)

/** A finger holds something it picked up (dragged or not yet). */
let fingerHolds = false
export const fingerHolding = () => fingerHolds
// The page mustn't scroll under a finger holding something: WebKit only lets a touchmove stop a begun scroll if a
// cancelable listener was there all along (as dnd-kit does).
if (typeof window !== "undefined") addEventListener("touchmove", (e) => { if (fingerHolds && e.cancelable) e.preventDefault() }, { passive: false })

type Target = {
  /** What a drop here would do, or null (not over this target, or nothing would change). Called on every move. */
  at: (item: DragItem, x: number, y: number, el: Element | null) => { data: unknown; hint?: string; weak?: boolean } | null
  drop: (item: DragItem, data: unknown) => void
  /** The drag ended (dropped or not): stop timers. */
  end?: () => void
}
const targets = new Map<string, Target>()

/** Take drops while mounted. `at` answers what a drop at (x, y) would do (`hint`: a word on the dragged item, like
 *  "Unpin"; `weak`: a catch-all answer, taken only when no other target answers); `drop` does it. */
export function useDropTarget<H>(id: string, at: (item: DragItem, x: number, y: number, el: Element | null) => H | null,
  drop: (item: DragItem, hit: H) => void, opts: { hint?: (hit: H) => string | undefined; weak?: (hit: H) => boolean; end?: () => void } = {}) {
  const ref = useRef({ at, drop, opts })
  useEffect(() => { ref.current = { at, drop, opts } })
  useEffect(() => {
    targets.set(id, {
      at: (item, x, y, el) => {
        const h = ref.current.at(item, x, y, el)
        return h === null ? null : { data: h, hint: ref.current.opts.hint?.(h), weak: ref.current.opts.weak?.(h) }
      },
      drop: (item, data) => ref.current.drop(item, data as H),
      end: () => ref.current.opts.end?.(),
    })
    return () => { targets.delete(id) }
  }, [id])
}

/** Scrolls a box while a drag holds the pointer near its edge, faster the closer: `near` on every move, `stop` when the
 *  pointer leaves or the drag ends. One per box. `alive`: whether to go on (default: while something is dragged). */
export function edgeScroller(axis: "x" | "y" = "y") {
  let speed = 0, frame = 0
  const stop = () => { speed = 0 }
  const near = (box: HTMLElement, at: number, alive: () => boolean = () => !!drag) => {
    // The window (a phone's page): between its header and its bar. A finger covers more, so its zone is wider.
    const b = box === document.scrollingElement
      ? { top: document.querySelector("[data-phone-header]")?.getBoundingClientRect().bottom ?? 0, bottom: document.querySelector("[data-phone-bar]")?.getBoundingClientRect().top ?? innerHeight, left: 0, right: innerWidth }
      : box.getBoundingClientRect()
    const [lo, hi] = axis === "x" ? [b.left, b.right] : [b.top, b.bottom]
    const zone = drag?.finger ? 48 : 24
    const d = at < lo + zone ? at - (lo + zone) : at > hi - zone ? at - (hi - zone) : 0
    speed = Math.max(-14, Math.min(14, Math.round(d / 2)))
    if (!speed || frame) return
    const step = () => {
      if (!speed || !alive()) { frame = 0; return }
      if (axis === "x") box.scrollLeft += speed
      else box.scrollTop += speed
      // What's under the pointer moved: what a drop there would do too (the line follows, without a pointer move).
      if (drag) setDrag({ ...drag, hit: hitAt(drag.item, drag.x, drag.y) })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }
  return { near, stop }
}

/** Ask the targets again what a drop where the pointer rests would do: for an answer that changes with time while the
 *  pointer is still (a card held over another groups them after a moment: TabSwitcher). */
export function rehit() { if (drag) setDrag({ ...drag, hit: hitAt(drag.item, drag.x, drag.y) }) }

/** What a drop on this target would do right now, while something is dragged over it. */
export function useDropHit<H>(id: string): H | null {
  const d = useDrag()
  return d?.hit?.target === id ? (d.hit.data as H) : null
}

function hitAt(item: DragItem, x: number, y: number): Hit | null {
  const el = document.elementFromPoint(x, y)
  let hit: Hit | null = null, weak: Hit | null = null
  // Every target hears every move (the tree scrolls near its edge, opens a folder held over), the first answer wins,
  // a weak one only when nothing else answers.
  for (const [id, t] of targets) {
    const h = t.at(item, x, y, el)
    if (h?.weak) weak ??= { target: id, ...h }
    else if (h) hit ??= { target: id, ...h }
  }
  return hit ?? weak
}

/** The drag is on: one cursor, no text selection. Returns how it ends: the highlight goes, and a drop (`hit`) is done;
 *  the click that ends it opens nothing. */
function lift(item: DragItem, finger = false) {
  const root = document.documentElement, select = root.style.userSelect
  root.style.userSelect = "none"
  // One cursor for the whole drag (index.css), not a text cursor over an editor and a hand over a button.
  root.dataset.dragging = ""
  getSelection()?.removeAllRanges()
  return (hit: Hit | null | undefined) => {
    root.style.userSelect = select
    delete root.dataset.dragging
    // (Before the click below is swallowed: a page's tap is a click too, core/haptics.ts.)
    if (hit && finger) haptic("medium")
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation() }
    addEventListener("click", swallow, true)
    setTimeout(() => removeEventListener("click", swallow, true))
    if (hit) { targets.get(hit.target)?.drop(item, hit.data); noteDrop(item, hit) }
  }
}

/** What a drag let go outside the window does (a pop-out's tab goes back to the main window: core/windows.ts), given
 *  where on the screen; true if it took it. */
let outside: ((item: DragItem, screen: { x: number; y: number }) => boolean) | null = null
export const setOutsideDrop = (fn: typeof outside) => { outside = fn }

/** Press on something draggable: a mouse or pen, or a finger where `touch` says a phone has somewhere to drop it (else
 *  a finger scrolls or taps). `data-no-drag` children stay plain buttons. */
export function startDrag(e: React.PointerEvent<HTMLElement>, item: DragItem, { touch = false }: { touch?: boolean } = {}) {
  if (e.button !== 0 || (e.target as Element).closest("[data-no-drag]")) return
  if (e.pointerType === "touch") { if (touch) pickUp(e, item); return }
  const el = e.currentTarget, x0 = e.clientX, y0 = e.clientY, id = e.pointerId
  let end: ReturnType<typeof lift> | null = null
  let last: PointerEvent | null = null
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return
    last = ev
    if (!end) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      // Captured, so the drag goes on over frames (artifacts, terminals) and outside the window.
      try { el.setPointerCapture(id) } catch { /* already gone */ }
      end = lift(item)
    }
    setDrag({ item, x: ev.clientX, y: ev.clientY, hit: hitAt(item, ev.clientX, ev.clientY) })
  }
  // A link or an image inside would start the browser's own drag.
  const native = (ev: DragEvent) => ev.preventDefault()
  const stop = (drop: boolean) => {
    removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true); removeEventListener("pointercancel", cancel, true)
    removeEventListener("keydown", key, true); removeEventListener("dragstart", native, true)
    quit()
    const hit = drag?.hit
    setDrag(null)
    for (const t of targets.values()) t.end?.()
    const out = !!last && (last.clientX < 0 || last.clientY < 0 || last.clientX >= innerWidth || last.clientY >= innerHeight)
    end?.(drop ? hit : null)
    if (drop && end && !hit && out) outside?.(item, { x: last!.screenX, y: last!.screenY })
  }
  const up = (ev: PointerEvent) => { if (ev.pointerId === id) stop(true) }
  const cancel = (ev: PointerEvent) => { if (ev.pointerId === id) stop(false) }
  const key = (ev: KeyboardEvent) => { if (ev.key === "Escape" && end) { ev.preventDefault(); ev.stopPropagation(); stop(false) } }
  addEventListener("pointermove", move, true); addEventListener("pointerup", up, true); addEventListener("pointercancel", cancel, true)
  addEventListener("keydown", key, true); addEventListener("dragstart", native, true)
  // The app sent away mid-drag (core/away.ts): it's dropped nowhere.
  const quit = onAway(() => stop(false))
}

/** A finger: picked up when the hold fires, dragged once it moves 10px (an open menu closes); before that, moving is a
 *  scroll. Touch events, since they go on while the page is held still. */
function pickUp(e: React.PointerEvent<HTMLElement>, item: DragItem) {
  const el = e.currentTarget
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
    const hit = drag?.hit
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

const PLACES = { panes: "a pane", panels: "the sidebar", pins: "Pinned", workspaces: "another workspace", newtab: "its place on the new tab" }
/** A drop, in a few words for Activity: what (its path, label or tab) and where (the target's kind, and a folder or a
 *  column when that's what the target answered). */
function noteDrop(item: DragItem, hit: Hit) {
  const what = item.path || item.label || item.to?.replace(/^(file|view):/, "") || item.from
  const kind = hit.target.split(":")[0]
  const where = (PLACES as Record<string, string | undefined>)[kind]
    ?? (typeof hit.data === "string" ? hit.data || "the vault's top folder" : kind.replace(/-/g, " "))
  noteActivity("drop", `Dragged ${what} to ${where}`, item.path ? [item.path] : undefined)
}
