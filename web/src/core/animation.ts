import { getPrefs } from "@/core/prefs"

export type Pace = "fast" | "base" | "spring"

export const still = () => getPrefs().animation === "off" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)

/** Whether things move: nothing asks for stillness, and Web Animations are there. */
export function moves() {
  return typeof document !== "undefined" && typeof document.documentElement.animate === "function" && !still()
}

/** A scroll's `behavior`: smooth, unless things are kept still. */
export const glide = (): ScrollBehavior => (still() ? "instant" : "smooth")

const SPRING = "linear(0, 0.0155, 0.056, 0.1138, 0.1826, 0.2575, 0.3347, 0.4113, 0.4852, 0.5549, 0.6195, 0.6783, 0.7312, 0.7782, 0.8193, 0.855, 0.8856, 0.9115, 0.9331, 0.9511, 0.9657, 0.9774, 0.9867, 0.9938, 0.9992, 1.0031, 1.0059, 1.0076, 1.0086, 1.0089, 1.0088, 1.0084, 1.0077, 1.0069, 1.0059, 1.0049, 1.0038, 1.0028, 1.0018, 1.0009, 1)"
const OUT = "cubic-bezier(0.2, 0, 0, 1)"
export const PACES = {
  natural: { fast: [140, OUT], base: [220, OUT], spring: [295, SPRING] },
  snappy: { fast: [90, OUT], base: [150, OUT], spring: [200, OUT] },
} as const

export function timing(pace: Pace = "base"): { duration: number; easing: string } {
  if (!moves()) return { duration: 0, easing: "linear" }
  const [duration, easing] = PACES[getPrefs().animation === "snappy" ? "snappy" : "natural"][pace]
  return { duration, easing }
}

/** FLIP: `el` was at `from` and is now laid out where it goes; it moves (and scales) from there to its place. */
export function slideFrom(el: HTMLElement, from: DOMRect, pace: Pace = "spring", scale = false) {
  const t = timing(pace)
  if (!t.duration) return null
  const to = el.getBoundingClientRect()
  const dx = from.left - to.left, dy = from.top - to.top
  const sx = scale && to.width ? from.width / to.width : 1, sy = scale && to.height ? from.height / to.height : 1
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) return null
  return el.animate([{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }], t)
}

const BLINK = 100

export type Leaving = {
  pace?: Pace
  scale?: number
  scaled?: string
  backdrop?: string
  tag?: string
  lit?: Element | null
  blink?: boolean
}

export function fadeAway(els: readonly (Element | null | undefined)[], o: Leaving = {}) {
  const all = els.filter((e): e is HTMLElement => !!e?.isConnected && "style" in e)
  if (!all.length || !moves()) return
  const doc = all[0].ownerDocument, HTML = doc.defaultView?.HTMLElement ?? HTMLElement
  const { duration, easing } = timing(o.pace ?? "fast")
  const host = doc.createElement("div")
  host.dataset.fading = o.tag ?? ""
  host.inert = true
  host.setAttribute("aria-hidden", "true")
  // Over a modal <dialog>, it goes in the top layer too: nothing else draws above one.
  const top = typeof host.showPopover === "function" && [...doc.querySelectorAll("dialog[open]")].some((d) => { try { return d.matches(":modal") } catch { return false } })
  if (top) host.popover = "manual"
  host.style.cssText = "position:fixed;inset:0;width:auto;height:auto;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;color:inherit;z-index:2147483647"
  const parts: HTMLElement[] = [], copies: HTMLElement[] = []
  if (o.backdrop) {
    const b = doc.createElement("div")
    b.style.cssText = `position:fixed;inset:0;background:${o.backdrop}`
    host.append(b); parts.push(b)
  }
  const lit = o.lit && doc.defaultView ? doc.defaultView.getComputedStyle(o.lit).backgroundColor : ""
  let litCopy: HTMLElement | null = null
  const scrolled: [Element, number, number][] = []
  for (const el of all) {
    const r = el.getBoundingClientRect()
    const copy = doc.importNode(el, true)
    // What a copy doesn't keep: where it scrolled, what was typed, which part was lit.
    const from = [el, ...el.querySelectorAll("*")], to = [copy, ...copy.querySelectorAll("*")]
    for (const [i, f] of from.entries()) {
      const t = to[i]
      if (f === o.lit && t instanceof HTML) litCopy = t
      if (f.scrollTop || f.scrollLeft) scrolled.push([t, f.scrollTop, f.scrollLeft])
      if ((f.tagName === "INPUT" || f.tagName === "TEXTAREA") && "value" in f && "value" in t) t.value = f.value
    }
    for (const t of to) { t.removeAttribute("id"); t.removeAttribute("role") }
    Object.assign(copy.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, right: "auto", bottom: "auto", width: `${r.width}px`,
      height: `${r.height}px`, margin: "0", transform: "none", translate: "none", scale: "none", visibility: "visible" })
    host.append(copy); parts.push(copy); copies.push(copy)
  }
  doc.body.append(host)
  if (top) host.showPopover()
  for (const [el, y, x] of scrolled) { el.scrollTop = y; el.scrollLeft = x }
  const delay = litCopy && o.blink ? BLINK : 0
  if (litCopy) {
    const row = litCopy
    row.style.backgroundColor = lit
    if (o.blink) row.animate([{ backgroundColor: "transparent" }, { backgroundColor: "transparent", offset: 0.5 }, { backgroundColor: lit, offset: 0.5 }, { backgroundColor: lit }], { duration: BLINK })
  }
  // Each part fades itself, not the layer they're in: an ancestor fading would cut a glass menu's blur off what's under it.
  const fades = parts.map((p) => p.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, delay, fill: "forwards" }))
  if (o.scale && o.scale !== 1) for (const c of copies) {
    const s = o.scaled ? c.querySelector(o.scaled) : c
    s?.animate([{ scale: "1" }, { scale: String(o.scale) }], { duration, easing, delay, fill: "forwards" })
  }
  const gone = () => { if (top && host.matches(":popover-open")) host.hidePopover(); host.remove() }
  Promise.all(fades.map((f) => f.finished)).then(gone, gone)
}

export function dropLeaving(tag: string, doc: Document = document) {
  for (const el of doc.querySelectorAll(`[data-fading="${CSS.escape(tag)}"]`)) el.remove()
}

export function refuse(el: Element | null | undefined) {
  if (!el || !moves()) return
  el.animate([{ translate: "0" }, { translate: "-7px" }, { translate: "6px" }, { translate: "-4px" }, { translate: "3px" }, { translate: "-1px" }, { translate: "0" }],
    { duration: 380, easing: "ease-in-out", composite: "add" })
}
