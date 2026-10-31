// The window over its pages (electron/appwindow.ts): raised while anything of it covers a page, see-through behind
// each so the live page shows there, passing the pointer on where nothing of it is (but under a menu, dialog or drag).
import { webPages } from "@vaultite"

/** What covers a page: something that takes every click over it ("app": a menu, a dialog, a drag), only what lets the
 *  rest through ("through": a toast, the mini player, a sidebar peeking over it), or nothing (null). */
export type Cover = "app" | "through" | null

const covers = new Map<number, Cover>()
let raised: Cover = null

/** Page `id` is covered so now; the window is raised as the most any page needs. */
export function setCover(id: number, c: Cover) {
  if ((covers.get(id) ?? null) === c) return
  if (c) covers.set(id, c)
  else covers.delete(id)
  const all = [...covers.values()], want: Cover = all.includes("app") ? "app" : all.length ? "through" : null
  if (want === raised) return
  raised = want
  if (want) document.documentElement.dataset.overPages = ""
  else delete document.documentElement.dataset.overPages
  void webPages?.raise(want).catch(() => {})
}

/** What the app draws over pages that says what it is: dialogs (the app's menus, sheets and boxes are), popovers, menus
 *  and lists. Found wherever they are, however small. */
const POPUPS = "dialog[open], :popover-open, [role=menu], [role=listbox], [role=dialog], [role=alertdialog]"
// (a float takes the pointer only on itself, as a toast does: the agents' panel)
const NEVER = "[data-sonner-toaster], [data-under-pages], [data-status-bar], [data-floats]"
/** Whether a popup is open anywhere (a page isn't shown before what covers it is known). */
export const popupOpen = () => [...document.querySelectorAll(POPUPS)].some((p) => p.getClientRects().length > 0)
/** How far apart the hit tests along the page's edges are, and how many across its inside. */
const EDGE_STEP = 64, INSIDE = 4

/** What's over the page: a popup or a drag takes every click there ("app": a click beside a menu only closes it), else
 *  each its own ("through"). Toasts, the status bar never count. Hit tests: popups where they are, the edges, a few inside. */
export function hitCover(box: HTMLElement, r: DOMRect): Cover {
  if ("dragging" in document.documentElement.dataset) return "app"
  // (8px in from the edges: the dividers beside a pane, the sidebar's edge, a split's, reach a few pixels into it)
  const E = 8, L = r.left + E, T = r.top + E, R = r.right - E, B = r.bottom - E
  if (R <= L || B <= T) return null
  const w = innerWidth - 1, h = innerHeight - 1
  const hit = (x: number, y: number) => document.elementFromPoint(Math.min(w, x), Math.min(h, y))
  const over = (at: Element | null) => !!at && at !== box && !box.contains(at) && !at.closest(NEVER)
  // A popup over the page, hit where it is: its middle and around it (one with no pointer is a float's, below).
  for (const p of document.querySelectorAll(POPUPS)) {
    if (box.contains(p)) continue
    const b = p.getBoundingClientRect()
    const left = Math.max(b.left, L), right = Math.min(b.right, R), top = Math.max(b.top, T), bottom = Math.min(b.bottom, B)
    if (left >= right || top >= bottom) continue
    const mx = (left + right) / 2, my = (top + bottom) / 2, dx = (right - left) / 4, dy = (bottom - top) / 4
    for (const [x, y] of [[mx, my], [mx - dx, my - dy], [mx + dx, my - dy], [mx - dx, my + dy], [mx + dx, my + dy]]) {
      const at = hit(x, y)
      if (over(at) && (at === p || p.contains(at))) return "app"
    }
  }
  // Along the edges, then a few across the inside.
  const steps = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)
  const xs = steps(L, R, Math.max(1, Math.ceil((R - L) / EDGE_STEP))), ys = steps(T, B, Math.max(1, Math.ceil((B - T) / EDGE_STEP)))
  for (const x of xs) if (over(hit(x, T)) || over(hit(x, B))) return "through"
  for (const y of ys.slice(1, -1)) if (over(hit(L, y)) || over(hit(R, y))) return "through"
  for (const x of steps(L, R, INSIDE).slice(1, -1)) for (const y of steps(T, B, INSIDE).slice(1, -1)) if (over(hit(x, y))) return "through"
  return slides(box, new DOMRect(L, T, R - L, B - T)) ? "through" : null
}

/** A transition of only a colour: it moves nothing. */
const COLOUR = /color|shadow|outline|fill|stroke/
/** Whether something moving or fading (a sidebar sliding in or out) is over `r` now or where it stops: the window is
 *  raised for its whole run. By its box, not hit tests: what slides out is already inert, and what slides in not there yet. */
function slides(box: HTMLElement, r: DOMRect) {
  const runs = new Map<Element, Animation[]>(), holding: Animation[] = []
  for (const a of document.getAnimations()) {
    const t = a.effect instanceof KeyframeEffect ? a.effect.target : null, end = a.effect?.getComputedTiming().endTime
    if (!t || a.playState !== "running" || typeof end !== "number" || !Number.isFinite(end)) continue
    if (a instanceof CSSTransition && COLOUR.test(a.transitionProperty)) continue
    // (what holds the page moves it, never covers it: a pane resizing)
    if (t.contains(box)) holding.push(a)
    else if (!box.contains(t) && !t.closest(NEVER) && changeAt(t, box) === "hits") runs.set(t, [...(runs.get(t) ?? []), a])
  }
  if (!runs.size) return false
  const crosses = (at: DOMRect) => [...runs.keys()].some((t) => { const b = t.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !!overlap(b, at) })
  if (crosses(r)) return true
  // Where they stop, against where the page will be: each looked at just before its end (at it, it would finish and say
  // so), then put back unseen.
  const now = box.getBoundingClientRect(), all = [...runs.values()].flat().concat(holding), was = all.map((a) => a.currentTime)
  try {
    for (const a of all) a.currentTime = (a.effect!.getComputedTiming().endTime as number) - 0.01
    const b = box.getBoundingClientRect()
    return crosses(new DOMRect(r.left + b.left - now.left, r.top + b.top - now.top, r.width + b.width - now.width, r.height + b.height - now.height))
  } finally {
    all.forEach((a, i) => { a.currentTime = was[i] ?? 0 })
  }
}

/** Whether only what lets the pointer through is over the page ("through"): tooltips and toasts, found by where they are
 *  (they take no pointer, so no hit test finds them). */
export function floatCover(r: DOMRect): Cover {
  const floats = document.querySelectorAll<HTMLElement>("[data-floats], [data-sonner-toast][data-visible=true]:not([data-removed=true])")
  for (const f of floats) { const b = f.getBoundingClientRect(); if (b.width > 1 && b.height > 1 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return "through" }
  return null
}

/** What a change may change of what covers `box`: "hits", only its floats (in a toast or tooltip), or nothing (in the
 *  box, the status bar, or another pane, whose scroller clips it, but for a fixed element added there). */
export type Change = "hits" | "floats" | null
function changeAt(t: Element | null, box: HTMLElement): Change {
  if (!t || box.contains(t) || t.closest("[data-status-bar]")) return null
  if (t.closest("[data-sonner-toaster], [data-floats]")) return "floats"
  const pane = t.closest("[data-pane], [data-kept]")
  return !pane || pane === t || pane.contains(box) ? "hits" : null
}
export function matters(r: MutationRecord, box: HTMLElement): Change {
  const t = r.target instanceof Element ? r.target : r.target.parentElement
  const c = changeAt(t, box)
  if (c || !t || box.contains(t) || t.closest("[data-status-bar]")) return c
  return r.type === "childList" && [...r.addedNodes].some((n) => n instanceof HTMLElement && getComputedStyle(n).position === "fixed") ? "hits" : null
}
/** The events `moved` reads. */
export const SLIDES = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"]
/** The same for a transition or animation that started or ended: what slides is looked at where it goes (`slides`) and
 *  again where it stopped (never a colour's). */
export function moved(e: Event, box: HTMLElement): Change {
  if (e instanceof TransitionEvent && COLOUR.test(e.propertyName)) return null
  return e.target instanceof Element ? changeAt(e.target, box) : null
}

/** Electron's cursor names (Chromium's: "pointer" is the arrow, "hand" CSS's pointer) that are CSS's too; the rest, a
 *  site's own image among them, show the arrow. */
const CURSORS = new Set(["crosshair", "text", "wait", "help", "e-resize", "n-resize", "ne-resize", "nw-resize",
  "s-resize", "se-resize", "sw-resize", "w-resize", "ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "col-resize", "row-resize",
  "move", "vertical-text", "cell", "context-menu", "alias", "progress", "copy", "none", "not-allowed", "zoom-in", "zoom-out", "grab", "grabbing"])
const RENAMED: Record<string, string> = { hand: "pointer", nodrop: "no-drop" }
export const cssCursor = (c: unknown) => (typeof c !== "string" ? "" : RENAMED[c] ?? (CURSORS.has(c) ? c : ""))

/** The pointer over a page's box while the window lets it through, passed on to the page, and the page's cursor shown
 *  there. A press in the page keeps the pointer till it's let go, as a real one does (a drag out over the mini player). */
export function passPointer(box: HTMLElement, id: () => number | null, area: () => DOMRect) {
  let held = 0
  const send = (e: MouseEvent, type: "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel") => {
    const page = id()
    if (raised !== "through" || page === null) return
    const r = area()
    void webPages?.pointer(page, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: (["left", "middle", "right"] as const)[e.button] ?? "left",
      clickCount: e.detail || 1, dx: e instanceof WheelEvent ? e.deltaX : 0, dy: e instanceof WheelEvent ? e.deltaY : 0 }).catch(() => {})
  }
  const inBox = (e: Event) => e.target instanceof Node && box.contains(e.target)
  const bit = (e: MouseEvent) => 1 << e.button
  const on: [EventTarget, string, (e: MouseEvent) => void][] = [
    [box, "mousedown", (e) => { if (raised === "through") held |= bit(e); send(e, "mouseDown") }],
    [window, "mousemove", (e) => { if (held || inBox(e)) send(e, "mouseMove") }],
    [window, "mouseup", (e) => { if (held & bit(e) || inBox(e)) { held &= ~bit(e); send(e, "mouseUp") } }],
    [box, "mouseleave", (e) => { if (!held) send(e, "mouseLeave") }],
    [box, "wheel", (e) => send(e, "mouseWheel")]]
  for (const [at, ev, fn] of on) at.addEventListener(ev, fn as EventListener, { passive: true })
  // (the box is under the page but while the window's over it: its cursor is then the one macOS shows)
  const off = webPages?.on((m) => { if (m.type === "cursor" && m.id === id()) box.style.cursor = cssCursor(m.cursor) })
  return () => { for (const [at, ev, fn] of on) at.removeEventListener(ev, fn as EventListener); off?.(); box.style.cursor = "" }
}

// ---------- the hole: only backgrounds are cut, never what's drawn over the page ----------

const holes = new Map<number, { box: HTMLElement; r: DOMRect }>()
/** The elements whose backgrounds are cut, with the CSS they were given. */
let cut = new Map<HTMLElement, string>()
let soon = 0

/** Page `id` shows at `r` of `box` (null: it doesn't): what's behind it is cut away. */
export function setHole(id: number, box: HTMLElement, r: DOMRect | null) {
  const had = holes.get(id)
  if (!r) { if (!had) return; holes.delete(id) }
  else if (had && had.box === box && same(had.r, r)) return
  else holes.set(id, { box, r })
  schedule()
}
const same = (a: DOMRect, b: DOMRect) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
export const sameRect = (a: DOMRect | null, b: DOMRect | null) => (a && b ? same(a, b) : a === b)
/** Where `a` and `b` overlap (null: nowhere). */
export function overlap(a: DOMRect, b: DOMRect) {
  const l = Math.max(a.left, b.left), r = Math.min(a.right, b.right), t = Math.max(a.top, b.top), btm = Math.min(a.bottom, b.bottom)
  return l < r && t < btm ? new DOMRect(l, t, r - l, btm - t) : null
}
/** Once the holes as set now are on screen: two frames after the one that cuts them (it's then been shown). */
export const painted = () => new Promise<void>((done) => {
  if (document.hidden) { setTimeout(done, 50); return }
  const after = (n: number) => requestAnimationFrame(() => (n ? after(n - 1) : done()))
  after(2)
})
const schedule = () => { if (!soon) soon = requestAnimationFrame(apply) }

const STYLE = `[data-web-hole] { background-color: transparent !important; background-image: var(--web-hole-image) !important;
  background-size: var(--web-hole-size) !important; background-position: var(--web-hole-position) !important;
  background-repeat: no-repeat !important; background-origin: border-box !important; background-clip: border-box !important }`

function apply() {
  soon = 0
  if (!document.getElementById("web-hole-style")) {
    const s = document.createElement("style")
    s.id = "web-hole-style"
    s.textContent = STYLE
    document.head.append(s)
  }
  // Every element painting behind a page: its colour as four (or more) strips around the holes in it.
  const next = new Map<HTMLElement, string>()
  const under = new Map<HTMLElement, DOMRect[]>()
  for (const { box, r } of holes.values()) {
    for (let el: HTMLElement | null = box; el; el = el.parentElement) under.set(el, [...(under.get(el) ?? []), r])
  }
  for (const [el, rs] of under) {
    // (its own colour: read with the cut off, which restyles without painting)
    const was = el.hasAttribute("data-web-hole")
    if (was) el.removeAttribute("data-web-hole")
    const st = getComputedStyle(el), color = st.backgroundColor
    const paints = st.backgroundImage === "none" && !/^(transparent|rgba\(.*,\s*0\))$/.test(color)
    if (!paints) continue
    const b = el.getBoundingClientRect()
    const strips = rs.reduce((left, h) => left.flatMap((x) => minus(x, h)), [new DOMRect(b.left, b.top, b.width, b.height)])
    const css = strips.length
      ? `--web-hole-image: ${strips.map(() => `linear-gradient(${color}, ${color})`).join(", ")}; --web-hole-size: ${strips.map((s) => `${s.width}px ${s.height}px`).join(", ")}; --web-hole-position: ${strips.map((s) => `${s.left - b.left}px ${s.top - b.top}px`).join(", ")}`
      : "--web-hole-image: none; --web-hole-size: auto; --web-hole-position: 0 0"
    next.set(el, css)
    if (cut.get(el) !== css) { for (const d of css.split("; ")) { const [k, v] = d.split(": "); el.style.setProperty(k, v) } }
    el.setAttribute("data-web-hole", "")
  }
  for (const el of cut.keys()) if (!next.has(el)) { el.removeAttribute("data-web-hole"); for (const k of ["--web-hole-image", "--web-hole-size", "--web-hole-position"]) el.style.removeProperty(k) }
  cut = next
}

/** `a` without `h`: up to four rects. */
function minus(a: DOMRect, h: DOMRect): DOMRect[] {
  const l = Math.max(a.left, h.left), r = Math.min(a.right, h.right), t = Math.max(a.top, h.top), b = Math.min(a.bottom, h.bottom)
  if (l >= r || t >= b) return [a]
  const out = [new DOMRect(a.left, a.top, a.width, t - a.top), new DOMRect(a.left, b, a.width, a.bottom - b),
    new DOMRect(a.left, t, l - a.left, b - t), new DOMRect(r, t, a.right - r, b - t)]
  return out.filter((x) => x.width > 0 && x.height > 0)
}

// (a theme or a pane's colour changing changes what's painted behind: cut again)
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(() => { if (holes.size) schedule() }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-translucent"] })
}
