import { moves } from "@vaultite"
import type { Move, Style } from "./slides"

const EASE = "cubic-bezier(0.26, 0.86, 0.44, 0.985)"

function pose(style: Style, d: number, vertical: boolean) {
  const t3 = (v: string) => `translate3d(${vertical ? `0, ${v}, 0` : `${v}, 0, 0`})`
  const turn = (deg: number) => `${vertical ? "rotateX" : "rotateY"}(${deg * d}deg)`
  switch (style) {
    case "slide": return vertical ? `translate(0, ${150 * d}%)` : `translate(${150 * d}%, 0)`
    case "convex": { const t = t3(vertical ? `${300 * d}px` : `${100 * d}%`); return `perspective(600px) ${t} ${turn(vertical ? -70 : 90)} ${t}` }
    case "concave": { const t = t3(`${(vertical ? 80 : 100) * d}%`); return `perspective(600px) ${t} ${turn(vertical ? 70 : -90)} ${t}` }
    case "zoom": return `scale(${d < 0 ? 16 : d > 0 ? 0.2 : 1})`
    default: return "none"
  }
}

const MATCH = "[data-id], h1, h2, h3, h4, h5, h6, p, li, pre, img, video, iframe"
const TEXT = /^(H[1-6]|P|LI|PRE)$/
const keyOf = (el: Element) => {
  const id = el.getAttribute("data-id"), t = el.tagName
  if (id) return `${t}#${id}`
  const v = TEXT.test(t) ? el.textContent?.trim() : el.getAttribute("src")
  return v ? `${t}:${v}` : ""
}
const LOOK = ["opacity", "color", "backgroundColor", "borderColor", "borderRadius"] as const
const TYPE = ["fontSize", "lineHeight", "letterSpacing"] as const
type Look = Record<string, string>
const lookOf = (cs: CSSStyleDeclaration): Look => Object.fromEntries([...LOOK, ...TYPE].map((p) => [p, cs[p]]))
const pick = (l: Look, text: boolean, k: number) => Object.fromEntries((text ? [...LOOK, ...TYPE] : LOOK)
  .map((p) => [p, (TYPE as readonly string[]).includes(p) && l[p].endsWith("px") ? `${Number.parseFloat(l[p]) * k}px` : l[p]]))
const scaleOf = (el: HTMLElement) => el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1

type Old = { key: string; rect: DOMRect; look: Look }
export type Leaving = { move: Move; stage: HTMLElement | null; bg: HTMLElement | null; scroll: number; tone: string; old: Old[]; scale: number }
export type Parts = { stage: HTMLElement; bg: HTMLElement | null; inner: HTMLElement }

function copy(el: HTMLElement) {
  const c = el.cloneNode(true) as HTMLElement
  c.inert = true
  c.setAttribute("aria-hidden", "true")
  c.dataset.slideLeaving = ""
  Object.assign(c.style, { position: "absolute", inset: "0", pointerEvents: "none" })
  for (const x of c.querySelectorAll("[data-deck-slide]")) x.removeAttribute("data-deck-slide")
  for (const f of c.querySelectorAll("iframe")) { f.removeAttribute("src"); f.removeAttribute("srcdoc") }
  for (const m of c.querySelectorAll("video, audio")) m.removeAttribute("autoplay")
  const canvases = el.querySelectorAll("canvas")
  c.querySelectorAll("canvas").forEach((k, n) => { try { k.getContext("2d")?.drawImage(canvases[n], 0, 0) } catch { /* a WebGL one stays blank */ } })
  return c
}

export function slideMotion() {
  let running: Animation[] = [], copies: Element[] = []
  const play = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions) => { const a = el.animate(frames, o); running.push(a); return a }
  const settle = () => {
    for (const a of running) a.finish()
    for (const c of copies) c.remove()
    running = []; copies = []
  }

  const leave = (move: Move, p: Parts, tone: string): Leaving | null => {
    settle()
    if (!moves() || (move.in === "none" && move.out === "none" && move.bg === "none" && !move.auto)) return null
    const old = move.auto ? [...p.inner.querySelectorAll(MATCH)].map((el) => ({ key: keyOf(el), rect: el.getBoundingClientRect(), look: lookOf(getComputedStyle(el)) })).filter((o) => o.key) : []
    return { move, stage: move.out === "none" ? null : copy(p.stage), bg: p.bg && move.bg !== "none" ? copy(p.bg) : null, scroll: p.stage.scrollTop, tone, old, scale: scaleOf(p.inner) }
  }

  const arrive = (l: Leaving, layer: HTMLElement, p: Parts, tone: string) => {
    const m = l.move, d = m.back ? -1 : 1
    const ease = (s: Style) => (s === "zoom" ? "ease" : EASE)
    const out = (c: HTMLElement, s: Style, ms: number) => {
      layer.append(c)
      copies.push(c)
      play(c, [{ transform: pose(s, 0, m.vertical), opacity: getComputedStyle(c).opacity }, { transform: pose(s, -d, m.vertical), opacity: 0 }],
        { duration: ms, easing: ease(s), fill: "forwards" }).onfinish = () => c.remove()
    }
    const come = (el: HTMLElement, s: Style, ms: number) => play(el, [{ transform: pose(s, d, m.vertical), opacity: 0 }, { transform: pose(s, 0, m.vertical), opacity: getComputedStyle(el).opacity }], { duration: ms, easing: ease(s) })
    if (m.bg !== "none") {
      if (l.bg) out(l.bg, m.bg, m.inMs)
      if (p.bg) come(p.bg, m.bg, m.inMs)
    }
    if (l.stage) {
      const scheme = document.documentElement.dataset.scheme
      if (l.tone !== tone) l.stage.classList.add(l.tone === "dark" ? "dark" : "scheme-preview")
      if (l.tone !== tone && scheme) l.stage.dataset.scheme = scheme
      out(l.stage, m.out, m.outMs)
      l.stage.scrollTop = l.scroll
    }
    if (m.in !== "none") come(p.stage, m.in, m.inMs)
    if (m.auto) autoAnimate(l, p.inner, m.auto)
  }

  const autoAnimate = (l: Leaving, inner: HTMLElement, o: NonNullable<Move["auto"]>) => {
    const s = scaleOf(inner), k = l.scale / s
    const pairs = new Map<HTMLElement, Old>(), used = new Set<Old>(), seen = new Map<string, number>()
    for (const el of inner.querySelectorAll<HTMLElement>(MATCH)) {
      const key = keyOf(el), from = key ? l.old.filter((x) => x.key === key) : []
      const j = seen.get(key) ?? 0
      seen.set(key, j + 1)
      const at = [from[j], from[from.length - 1]].find((x) => x && !used.has(x))
      if (at) { used.add(at); pairs.set(el, at) }
    }
    const nested = (el: HTMLElement) => { for (let a = el.parentElement; a && a !== inner; a = a.parentElement) if (pairs.has(a)) return true; return false }
    for (const [el, from] of pairs) {
      const r = el.getBoundingClientRect()
      if (nested(el) || !r.width || !r.height) continue
      const text = TEXT.test(el.tagName)
      const scale = text ? "" : ` scale(${from.rect.width / r.width}, ${from.rect.height / r.height})`
      play(el, [
        { transform: `translate(${(from.rect.left - r.left) / s}px, ${(from.rect.top - r.top) / s}px)${scale}`, transformOrigin: "top left", ...pick(from.look, text, k) },
        { transform: "none", transformOrigin: "top left", ...pick(lookOf(getComputedStyle(el)), text, 1) },
      ], { duration: Number.parseFloat(el.dataset.autoAnimateDuration ?? "") * 1000 || o.ms, delay: Number.parseFloat(el.dataset.autoAnimateDelay ?? "") * 1000 || 0,
        easing: el.dataset.autoAnimateEasing || o.easing, fill: "backwards" })
    }
    if (!o.unmatched) return
    const hit = [...pairs.keys()]
    const fade = (root: Element) => {
      for (const c of root.children) {
        if (pairs.has(c as HTMLElement)) continue
        if (hit.some((h) => c.contains(h))) fade(c)
        else play(c, [{ opacity: 0 }, { opacity: getComputedStyle(c).opacity }], { duration: o.ms * 0.8, delay: o.ms * 0.2, easing: "ease", fill: "backwards" })
      }
    }
    fade(inner)
  }
  return { leave, arrive, settle }
}
