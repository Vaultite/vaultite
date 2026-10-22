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

/** What covers the page at `r` of `box`: anything of the app's over it (sampled every ~48px), toasts and tooltips
 *  only, or nothing. A companion's cursor (`data-under-pages`) and the status bar never count. */
export function coverOf(box: HTMLElement, r: DOMRect): Cover {
  if ("dragging" in document.documentElement.dataset) return "app"
  // (8px in from the edges: the dividers beside a pane, the sidebar's edge, a split's, reach a few pixels into it)
  const E = 8, cw = r.width - 2 * E, ch = r.height - 2 * E
  if (cw <= 0 || ch <= 0) return null
  const cols = Math.min(40, Math.max(2, Math.ceil(cw / 48) + 1)), rows = Math.min(40, Math.max(2, Math.ceil(ch / 48) + 1))
  const w = innerWidth - 1, h = innerHeight - 1
  for (let i = 0; i < cols; i++) {
    const x = Math.min(w, r.left + E + (cw * i) / (cols - 1))
    for (let j = 0; j < rows; j++) {
      const at = document.elementFromPoint(x, Math.min(h, r.top + E + (ch * j) / (rows - 1)))
      if (at && at !== box && !box.contains(at) && !at.closest("[data-sonner-toaster], [data-under-pages], [data-status-bar]")) return "app"
    }
  }
  // (tooltips take no pointer, so they're found by where they are)
  const floats = document.querySelectorAll<HTMLElement>("[data-floats], [data-sonner-toast][data-visible=true]:not([data-removed=true])")
  for (const f of floats) { const b = f.getBoundingClientRect(); if (b.width > 1 && b.height > 1 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return "through" }
  return null
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
