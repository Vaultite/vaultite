import { webPages } from "@vaultite"
import { overlap, sameBox, type Box, type Change, type Cover } from "./box.ts"


const covers = new Map<number, Cover>()
let raised: Cover = null

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

const POPUPS = "dialog[open], :popover-open, [role=menu], [role=listbox], [role=dialog], [role=alertdialog]"
const NEVER = "[data-sonner-toaster], [data-under-pages], [data-status-bar], [data-floats]"
export const popupOpen = () => [...document.querySelectorAll(POPUPS)].some((p) => p.getClientRects().length > 0)
const EDGE_STEP = 64, INSIDE = 4

export function hitCover(box: HTMLElement, r: Box): Cover {
  if ("dragging" in document.documentElement.dataset) return "app"
  const E = 8, L = r.left + E, T = r.top + E, R = r.right - E, B = r.bottom - E
  if (R <= L || B <= T) return null
  const w = innerWidth - 1, h = innerHeight - 1
  const hit = (x: number, y: number) => document.elementFromPoint(Math.min(w, x), Math.min(h, y))
  const over = (at: Element | null) => !!at && at !== box && !box.contains(at) && !at.closest(NEVER) && at.checkVisibility({ opacityProperty: true })
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
  const steps = (from: number, to: number, n: number) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n)
  const xs = steps(L, R, Math.max(1, Math.ceil((R - L) / EDGE_STEP))), ys = steps(T, B, Math.max(1, Math.ceil((B - T) / EDGE_STEP)))
  for (const x of xs) if (over(hit(x, T)) || over(hit(x, B))) return "through"
  for (const y of ys.slice(1, -1)) if (over(hit(L, y)) || over(hit(R, y))) return "through"
  for (const x of steps(L, R, INSIDE).slice(1, -1)) for (const y of steps(T, B, INSIDE).slice(1, -1)) if (over(hit(x, y))) return "through"
  return slides(box, new DOMRect(L, T, R - L, B - T)) ? "through" : null
}

const COLOUR = /color|shadow|outline|fill|stroke/
function slides(box: HTMLElement, r: DOMRect) {
  const runs = new Map<Element, Animation[]>(), holding: Animation[] = []
  for (const a of document.getAnimations()) {
    const t = a.effect instanceof KeyframeEffect ? a.effect.target : null, end = a.effect?.getComputedTiming().endTime
    if (!t || a.playState !== "running" || typeof end !== "number" || !Number.isFinite(end)) continue
    if (a instanceof CSSTransition && COLOUR.test(a.transitionProperty)) continue
    if (t.contains(box)) holding.push(a)
    else if (!box.contains(t) && !t.closest(NEVER) && changeAt(t, box) === "hits") runs.set(t, [...(runs.get(t) ?? []), a])
  }
  if (!runs.size) return false
  const crosses = (at: DOMRect) => [...runs.keys()].some((t) => { const b = t.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !!overlap(b, at) })
  if (crosses(r)) return true
  // Just before its end: at it, an animation finishes and fires its events.
  const now = box.getBoundingClientRect(), all = [...runs.values()].flat().concat(holding), was = all.map((a) => a.currentTime)
  try {
    for (const a of all) a.currentTime = (a.effect!.getComputedTiming().endTime as number) - 0.01
    const b = box.getBoundingClientRect()
    return crosses(new DOMRect(r.left + b.left - now.left, r.top + b.top - now.top, r.width + b.width - now.width, r.height + b.height - now.height))
  } finally {
    all.forEach((a, i) => { a.currentTime = was[i] ?? 0 })
  }
}

export function floatCover(r: Box): Cover {
  const floats = document.querySelectorAll<HTMLElement>("[data-floats], [data-sonner-toast][data-visible=true]:not([data-removed=true])")
  for (const f of floats) { const b = f.getBoundingClientRect(); if (b.width > 1 && b.height > 1 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return "through" }
  return null
}

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
export const SLIDES = ["transitionrun", "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel"]
export function moved(e: Event, box: HTMLElement): Change {
  if (e instanceof TransitionEvent && COLOUR.test(e.propertyName)) return null
  return e.target instanceof Element ? changeAt(e.target, box) : null
}

// Electron's cursor names: "hand" is CSS's pointer, "pointer" the arrow; the rest (a site's own image too) show the arrow.
const CURSORS = new Set(["crosshair", "text", "wait", "help", "e-resize", "n-resize", "ne-resize", "nw-resize",
  "s-resize", "se-resize", "sw-resize", "w-resize", "ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "col-resize", "row-resize",
  "move", "vertical-text", "cell", "context-menu", "alias", "progress", "copy", "none", "not-allowed", "zoom-in", "zoom-out", "grab", "grabbing"])
const RENAMED: Record<string, string> = { hand: "pointer", nodrop: "no-drop" }
export const cssCursor = (c: unknown) => (typeof c !== "string" ? "" : RENAMED[c] ?? (CURSORS.has(c) ? c : ""))

const KEYS = ["alt", "control", "meta", "shift"] as const
const HELD = { alt: "altKey", control: "ctrlKey", meta: "metaKey", shift: "shiftKey" } as const
export function passPointer(box: HTMLElement, id: () => number | null, area: () => DOMRect) {
  let held = 0
  const send = (e: MouseEvent, type: "mouseMove" | "mouseDown" | "mouseUp" | "mouseLeave" | "mouseWheel") => {
    const page = id()
    if ((raised !== "through" && !(held && (type === "mouseUp" || type === "mouseMove"))) || page === null) return
    const r = area()
    void webPages?.pointer(page, { type, x: e.clientX - r.left, y: e.clientY - r.top, button: (["left", "middle", "right"] as const)[e.button] ?? "left",
      clickCount: e.detail || 1, dx: e instanceof WheelEvent ? e.deltaX : 0, dy: e instanceof WheelEvent ? e.deltaY : 0,
      keys: KEYS.filter((k) => e[HELD[k]]) }).catch(() => {})
  }
  const inBox = (e: Event) => e.target instanceof Node && box.contains(e.target)
  const bit = (e: MouseEvent) => 1 << e.button
  const on: [EventTarget, string, (e: MouseEvent) => void][] = [
    [box, "mousedown", (e) => { if (raised === "through") held |= bit(e); send(e, "mouseDown") }],
    [window, "mousemove", (e) => { if (held || inBox(e)) send(e, "mouseMove") }],
    [window, "mouseup", (e) => { if (held & bit(e) || inBox(e)) { send(e, "mouseUp"); held &= ~bit(e) } }],
    [box, "mouseleave", (e) => { if (!held) send(e, "mouseLeave") }],
    [box, "wheel", (e) => send(e, "mouseWheel")]]
  for (const [at, ev, fn] of on) at.addEventListener(ev, fn as EventListener, { passive: true })
  const off = webPages?.on((m) => { if (m.type === "cursor" && m.id === id()) box.style.cursor = cssCursor(m.cursor) })
  return () => { for (const [at, ev, fn] of on) at.removeEventListener(ev, fn as EventListener); off?.(); box.style.cursor = "" }
}


const holes = new Map<number, { box: HTMLElement; r: Box; radius: number }>()
let cut = new Map<HTMLElement, string>()
let soon = 0

export function setHole(id: number, box: HTMLElement, r: Box | null, radius = 0) {
  const had = holes.get(id)
  if (!r) { if (!had) return; holes.delete(id) }
  else if (had && had.box === box && sameBox(had.r, r) && had.radius === radius) return
  else holes.set(id, { box, r, radius })
  schedule()
}
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
  const next = new Map<HTMLElement, string>()
  const under = new Map<HTMLElement, { r: Box; radius: number }[]>()
  for (const { box, r, radius } of holes.values()) {
    for (let el: HTMLElement | null = box; el; el = el.parentElement) under.set(el, [...(under.get(el) ?? []), { r, radius }])
  }
  for (const [el, rs] of under) {
    // Read with the cut off: a restyle within a task never paints.
    const was = el.hasAttribute("data-web-hole")
    if (was) el.removeAttribute("data-web-hole")
    const st = getComputedStyle(el), color = st.backgroundColor
    const paints = st.backgroundImage === "none" && !/^(transparent|rgba\(.*,\s*0\))$/.test(color)
    if (!paints) continue
    const b = el.getBoundingClientRect()
    const strips = rs.reduce((left, { r: h }) => left.flatMap((x) => minus(x, h)), [new DOMRect(b.left, b.top, b.width, b.height)])
    const parts = [...strips.map((s) => ({ image: `linear-gradient(${color}, ${color})`, s })), ...rs.flatMap((h) => corners(h.r, h.radius, color))]
    const css = parts.length
      ? `--web-hole-image: ${parts.map((p) => p.image).join(", ")}; --web-hole-size: ${parts.map(({ s }) => `${s.width}px ${s.height}px`).join(", ")}; --web-hole-position: ${parts.map(({ s }) => `${s.left - b.left}px ${s.top - b.top}px`).join(", ")}`
      : "--web-hole-image: none; --web-hole-size: auto; --web-hole-position: 0 0"
    next.set(el, css)
    if (cut.get(el) !== css) { for (const d of css.split("; ")) { const [k, v] = d.split(": "); el.style.setProperty(k, v) } }
    el.setAttribute("data-web-hole", "")
  }
  for (const el of cut.keys()) if (!next.has(el)) { el.removeAttribute("data-web-hole"); for (const k of ["--web-hole-image", "--web-hole-size", "--web-hole-position"]) el.style.removeProperty(k) }
  cut = next
}

function corners(h: Box, radius: number, color: string) {
  if (radius <= 0) return []
  const at = (x: number, y: number, centre: string) => ({ image: `radial-gradient(circle at ${centre}, transparent ${radius - 0.5}px, ${color} ${radius + 0.5}px)`,
    s: new DOMRect(x, y, radius, radius) })
  const R = h.right - radius, B = h.bottom - radius
  return [at(h.left, h.top, "100% 100%"), at(R, h.top, "0 100%"), at(h.left, B, "100% 0"), at(R, B, "0 0")]
}

function minus(a: DOMRect, h: Box): DOMRect[] {
  const l = Math.max(a.left, h.left), r = Math.min(a.right, h.right), t = Math.max(a.top, h.top), b = Math.min(a.bottom, h.bottom)
  if (l >= r || t >= b) return [a]
  const out = [new DOMRect(a.left, a.top, a.width, t - a.top), new DOMRect(a.left, b, a.width, a.bottom - b),
    new DOMRect(a.left, t, l - a.left, b - t), new DOMRect(r, t, a.right - r, b - t)]
  return out.filter((x) => x.width > 0 && x.height > 0)
}

if (typeof MutationObserver !== "undefined") {
  new MutationObserver(() => { if (holes.size) schedule() }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-translucent"] })
}
