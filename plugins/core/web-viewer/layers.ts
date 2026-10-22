// The window over its pages (electron/appwindow.ts): raised while anything of it covers a page, see-through behind
// each page so the live page shows there, and passing the pointer on to a page while only toasts or tooltips cover it.
import { webPages } from "@vaultite"

/** What covers a page: something that takes the pointer ("app"), only what lets it through, or nothing (null). */
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
const NEVER = "[data-sonner-toaster], [data-under-pages], [data-status-bar]"
/** Whether a popup is open anywhere (a page isn't shown before what covers it is known). */
export const popupOpen = () => [...document.querySelectorAll(POPUPS)].some((p) => p.getClientRects().length > 0)
/** How far apart the hit tests along the page's edges are, and how many across its inside. */
const EDGE_STEP = 64, INSIDE = 4

/** Whether anything of the app taking the pointer is over the page ("app"); a companion's cursor, the status bar, toasts
 *  never count. Hit tests are costly: popups where they are, the edges (what slides in), a few inside. */
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
  for (const x of xs) if (over(hit(x, T)) || over(hit(x, B))) return "app"
  for (const y of ys.slice(1, -1)) if (over(hit(L, y)) || over(hit(R, y))) return "app"
  for (const x of steps(L, R, INSIDE).slice(1, -1)) for (const y of steps(T, B, INSIDE).slice(1, -1)) if (over(hit(x, y))) return "app"
  return null
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
/** The same for a transition or animation that ended: what slid in is looked at where it stopped (never a colour's). */
export function moved(e: Event, box: HTMLElement): Change {
  if (e instanceof TransitionEvent && /color|shadow|outline|fill|stroke/.test(e.propertyName)) return null
  return e.target instanceof Element ? changeAt(e.target, box) : null
}

/** The pointer over a page's box while the window lets it through, passed on to the page. */
export function passPointer(box: HTMLElement, id: () => number | null, area: () => DOMRect) {
  const send = (e: MouseEvent, type: "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel") => {
    const page = id()
    if (raised !== "through" || page === null) return
    const r = area()
    void webPages?.pointer(page, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: (["left", "middle", "right"] as const)[e.button] ?? "left",
      clickCount: e.detail || 1, dx: e instanceof WheelEvent ? e.deltaX : 0, dy: e instanceof WheelEvent ? e.deltaY : 0 }).catch(() => {})
  }
  const on: [string, (e: MouseEvent) => void][] = [["mousemove", (e) => send(e, "mouseMove")], ["mousedown", (e) => send(e, "mouseDown")],
    ["mouseup", (e) => send(e, "mouseUp")], ["mouseleave", (e) => send(e, "mouseLeave")], ["wheel", (e) => send(e, "mouseWheel")]]
  for (const [ev, fn] of on) box.addEventListener(ev, fn as EventListener, { passive: true })
  return () => { for (const [ev, fn] of on) box.removeEventListener(ev, fn as EventListener) }
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
  new MutationObserver(() => { if (holes.size) schedule() }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] })
}
