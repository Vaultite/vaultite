import { flushSync } from "react-dom"
import { relockScroll } from "@/core/pagelock"
import { moves as zooms, still } from "@/core/animation"
import { cell } from "@/core/signal"

type Kind = "back" | "forward"

const moves = () => typeof document !== "undefined" && typeof document.startViewTransition === "function" && !still()

const VARS = ["--mto", "--mfrom"]
let running: ViewTransition | null = null

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(cap = 220) {
  await tick()
  const end = performance.now() + cap
  while (performance.now() < end && document.querySelector("main [aria-busy=true]")) await tick(16)
}

function run(kind: Kind, change: () => void | Promise<void>, before?: () => void) {
  if (!moves()) { void change(); return }
  running?.skipTransition()
  const root = document.documentElement
  before?.()
  root.dataset.motion = kind
  const t = document.startViewTransition(async () => {
    await change()
    await settle()
  })
  running = t
  t.finished.finally(() => {
    if (running !== t) return
    running = null
    delete root.dataset.motion
    for (const v of VARS) root.style.removeProperty(v)
  })
}

export type Spring = { at: (t: number) => number; ms: number; easing: string }
export function spring(response = 0.3, damping = 1, v = 0): Spring {
  const w = (2 * Math.PI) / response, z = damping
  let left: (t: number) => number
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z), b = (z * w - v) / wd
    left = (t) => Math.exp(-z * w * t) * (Math.cos(wd * t) + b * Math.sin(wd * t))
  } else left = (t) => Math.exp(-w * t) * (1 + (w - v) * t)
  let ms = 1
  for (let t = 0; t < 3000; t++) if (Math.abs(left(t / 1000)) > 0.002) ms = t + 1
  const at = (t: number) => (t * 1000 >= ms ? 1 : 1 - left(t))
  const curve = `linear(${Array.from({ length: 49 }, (_, i) => +at((ms * i) / 48000).toFixed(4)).join(", ")})`
  const easing = typeof CSS !== "undefined" && CSS.supports("transition-timing-function", curve) ? curve : "cubic-bezier(.2, .9, .1, 1)"
  return { at, ms, easing }
}

// Only transforms and opacity move, as iOS runs those off the main thread. Only the hero scales up, as iOS drops the
// tiles of a big scaled-up layer.
const ZOOM = spring(0.3, 1)
let zooming: Animation[] = []
let landed: (() => void) | null = null
let undo: (() => void)[] = []
function hold(el: HTMLElement, prop: "opacity" | "visibility" | "pointerEvents" | "background" | "minHeight", v: string) {
  const was = el.style[prop]
  el.style[prop] = v
  undo.push(() => { el.style[prop] = was })
}
function landing(done: () => void) {
  landed = done
  return () => landed === done
}
function finish() {
  const done = landed
  landed = null
  opening = null
  done?.()
  delete document.documentElement.dataset.tabZoom
  for (const a of zooming) a.cancel()
  zooming = []
  for (const u of undo) u()
  undo = []
}

const lingering = cell<string | null>(null)
const linger = lingering.set
export const useLingeringSheet = lingering.use

export const LIFT_RADIUS = 28

export function pageRect() {
  const top = document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0
  const bar = document.querySelector<HTMLElement>("[data-phone-bar]")
  const bottom = bar ? innerHeight - bar.offsetHeight : innerHeight
  return new DOMRect(0, top, innerWidth, Math.max(1, bottom - top))
}
function pageShape() {
  const r = pageRect()
  document.documentElement.style.setProperty("--tab-aspect", `${r.width} / ${r.height}`)
}

type Parts = { sheet: HTMLElement; scroller: HTMLElement; card: HTMLElement; shot: HTMLElement; grid: HTMLElement | null; heads: HTMLElement[]; chrome: HTMLElement[] }
function partsFor(sheet: ParentNode, id: string, block: ScrollLogicalPosition): Parts | null {
  const k = CSS.escape(id)
  const card = sheet.querySelector<HTMLElement>(`[data-tab-row="${k}"] [data-tab-card], [data-tab-mini="${k}"]`)
  const shot = card?.matches("[data-tab-mini]") ? card : card?.querySelector<HTMLElement>("[data-tab-shot]")
  const scroller = card?.closest<HTMLElement>(".overflow-y-auto"), dialog = card?.closest<HTMLElement>("dialog")
  const cell = card?.closest<HTMLElement>("[data-tab-row], [data-group-card]")
  if (!card || !shot?.querySelector("[data-tab-pic]") || !scroller || !dialog || !cell) return null
  cell.scrollIntoView({ block })
  return {
    sheet: dialog, scroller, card, shot, grid: card.closest<HTMLElement>("[data-tabs-grid]"),
    heads: [...dialog.querySelectorAll<HTMLElement>("[data-tabs-header], [data-group-head]")],
    chrome: [...dialog.querySelectorAll<HTMLElement>(":scope > header, :scope > footer")],
  }
}

type Hero = { el: HTMLElement; win: HTMLElement; inner: HTMLElement; face: HTMLElement[]; ground: HTMLElement | null; S: DOMRect; r: number; gr: number; drawn: boolean }
function heroOf(p: Parts): Hero {
  // All read before anything is written: a read after a write lays the whole list out again.
  const c = p.card.getBoundingClientRect(), S = p.shot.getBoundingClientRect(), sc = p.scroller.getBoundingClientRect()
  const left = c.left - sc.left + p.scroller.scrollLeft, top = c.top - sc.top + p.scroller.scrollTop
  const tops = [...p.card.children].map((k) => k.getBoundingClientRect().top)
  const radius = (x: Element | null) => (x ? parseFloat(getComputedStyle(x).borderTopLeftRadius) || 0 : 0)
  const r = radius(p.shot), gr = radius(p.card.querySelector("[data-card-ground]"))
  const el = p.card.cloneNode(true) as HTMLElement
  const win = p.card === p.shot ? el : el.querySelector<HTMLElement>("[data-tab-shot]")!
  const ground = el.querySelector<HTMLElement>("[data-card-ground]")
  const face: HTMLElement[] = []
  if (win !== el) [...el.children].forEach((x, i) => {
    if (!(x instanceof HTMLElement) || x === win || x === ground) return
    x.style.transformOrigin = `0 ${S.top - tops[i]}px`
    face.push(x)
  })
  const drawn = !el.querySelector("img[data-tab-picture]")
  for (const img of el.querySelectorAll("img")) img.decoding = "sync"
  unmark(el)
  el.dataset.tabHero = ""
  win.dataset.heroWindow = ""
  const inner = document.createElement("div")
  Object.assign(inner.style, { position: "absolute", inset: "0", transformOrigin: "0 0" })
  inner.append(...win.childNodes)
  win.append(inner)
  Object.assign(el.style, {
    position: "absolute", left: `${left}px`, top: `${top}px`,
    // No aspect-ratio: WebKit would widen it to its content's width.
    width: `${c.width}px`, height: `${c.height}px`, aspectRatio: "auto", minWidth: "0", margin: "0", zIndex: "30", pointerEvents: "none", transition: "none", scale: "none", opacity: "1",
    transformOrigin: `${S.left - c.left}px ${S.top - c.top}px`,
  })
  p.scroller.append(el)
  undo.push(() => el.remove())
  return { el, win, inner, face, ground, S, r, gr, drawn }
}

export function unmark(copy: HTMLElement) {
  copy.inert = true
  for (const x of [copy, ...copy.querySelectorAll("[data-tab-card], [data-tab-shot], [data-tab-pic], [data-tab-picture], [data-tab-mini], [data-card-ground], [id]")])
    for (const a of ["data-tab-card", "data-tab-shot", "data-tab-pic", "data-tab-picture", "data-tab-mini", "data-card-ground", "id"]) x.removeAttribute(a)
}

const go = (el: Element, keys: Keyframe[], o: KeyframeAnimationOptions) => { const a = el.animate(keys, o); zooming.push(a); return a }
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
function flyHero(h: Hero, A: DOMRect, B: DOMRect, ra: number[], rb: number[]) {
  const S = h.S, n = 40
  const keys = { el: [] as Keyframe[], fix: [] as Keyframe[], win: [] as Keyframe[], ground: [] as Keyframe[] }
  for (let i = 0; i <= n; i++) {
    const p = ZOOM.at((ZOOM.ms * i) / n / 1000), offset = i / n
    const sx = lerp(A.width, B.width, p) / S.width, sy = lerp(A.height, B.height, p) / S.height
    keys.el.push({ offset, transform: `translate(${lerp(A.left, B.left, p) - S.left}px, ${lerp(A.top, B.top, p) - S.top}px) scale(${sx}, ${sy})` })
    keys.fix.push({ offset, transform: `scale(1, ${sx / sy})` })
    const r = ra.map((a, j) => lerp(a, rb[j], p))
    keys.win.push({ offset, borderRadius: `${r.map((v) => `${v / sx}px`).join(" ")} / ${r.map((v) => `${v / sy}px`).join(" ")}` })
    keys.ground.push({ offset, borderRadius: `${h.gr / sx}px / ${h.gr / sy}px` })
  }
  const o = { duration: ZOOM.ms, easing: "linear", fill: "both" } as const
  go(h.el, keys.el, o)
  go(h.inner, keys.fix, o)
  for (const f of h.face) go(f, keys.fix, o)
  // Corners apart: iOS can't move them off the main thread, and the transforms stay right without them.
  go(h.win, keys.win, o)
  if (h.ground) go(h.ground, keys.ground, o)
}
function fade(els: Element[], a: Keyframe, b: Keyframe, from: number, to: number) {
  for (const el of els) go(el, [a, b], { delay: Math.max(0, from), duration: Math.max(1, to - Math.max(0, from)), easing: "linear", fill: "both" })
}
// Linear between the spring's points: iOS can't run a `linear()` easing off the main thread.
function sprung(el: Element, frame: (p: number) => Keyframe, n = 30) {
  go(el, Array.from({ length: n + 1 }, (_, i) => ({ ...frame(i === n ? 1 : ZOOM.at((ZOOM.ms * i) / n / 1000)), offset: i / n })), { duration: ZOOM.ms, easing: "linear", fill: "both" })
}
function scaled(el: HTMLElement, r: DOMRect, mid: { x: number; y: number }, a: number, b: number) {
  const transformOrigin = `${mid.x - r.left}px ${mid.y - r.top}px`
  sprung(el, (p) => ({ transformOrigin, transform: `scale(${lerp(a, b, p)})` }))
}
// A layer of its own, so it fades by opacity: a background colour can't move off the main thread.
function groundOf(sheet: HTMLElement, bg: string) {
  const g = document.createElement("div")
  Object.assign(g.style, { position: "absolute", inset: "0", pointerEvents: "none", background: bg })
  sheet.prepend(g)
  undo.push(() => g.remove())
  hold(sheet, "background", "transparent")
  return g
}

function whenOpen(id: string, then: (p: Parts | null) => void, tries = 6) {
  const d = document.querySelector("dialog[open]")
  const p = d && partsFor(d, id, "center")
  if (p || !tries) return then(p ?? null)
  requestAnimationFrame(() => whenOpen(id, then, tries - 1))
}
const finished = () => Promise.all(zooming.map((a) => a.finished)).then(() => {}, () => {})

let opening: { id: string; h: Hero; ground: HTMLElement; p: Parts } | null = null
type Caught = { id: string; win: DOMRect; r: number; face: number; card: number; sheet: number; grid: number; heads: number; chrome: number }
function caught(): Caught | null {
  const o = opening
  if (!o) return null
  const at = (el?: Element | null) => (el ? +getComputedStyle(el).opacity : 1)
  const win = o.h.win.getBoundingClientRect(), P = pageRect()
  const k = Math.min(1, Math.max(0, (P.width - win.width) / Math.max(1, P.width - o.h.S.width)))
  return { id: o.id, win, r: o.h.r * k, face: at(o.h.face[0]), card: at(o.h.ground), sheet: at(o.ground), grid: at(o.p.grid), heads: at(o.p.heads[0]), chrome: at(o.p.chrome[0]) }
}

export function zoomOut(open: () => void, current: () => string, page?: DOMRect, reset?: () => void) {
  finish()
  pageShape()
  if (!zooms()) { reset?.(); open(); return }
  const P = pageRect()
  flushSync(open)
  whenOpen(current(), (p) => {
    if (!p) { reset?.(); return }
    const mine = landing(() => reset?.())
    const bg = getComputedStyle(p.sheet).backgroundColor, h = heroOf(p), T = ZOOM.ms, ground = groundOf(p.sheet, bg)
    document.documentElement.dataset.tabZoom = ""
    opening = { id: current(), h, ground, p }
    hold(p.card, "visibility", "hidden")
    const main = document.querySelector<HTMLElement>("#main-scroll > main")
    if (main) hold(main, "visibility", "hidden")
    const tap = p.card.querySelector<HTMLElement>(":scope > button")
    if (tap) hold(tap, "visibility", "visible")
    const lr = page ? LIFT_RADIUS * (page.width / P.width) : 0
    flyHero(h, page ?? P, h.S, [0, 0, lr, lr], [h.r, h.r, h.r, h.r])
    fade([ground], { opacity: 0 }, { opacity: 1 }, 0, 0.3 * T)
    fade(p.chrome, { opacity: 0 }, { opacity: 1 }, 0.05 * T, 0.4 * T)
    fade(p.heads, { opacity: 0 }, { opacity: 1 }, 0.1 * T, 0.45 * T)
    if (p.grid) fade([p.grid], { opacity: 0 }, { opacity: 1 }, 0.05 * T, 0.45 * T)
    fade(h.face, { opacity: 0 }, { opacity: 1 }, 0.3 * T, 0.65 * T)
    if (h.ground) fade([h.ground], { opacity: 0 }, { opacity: 1 }, 0.25 * T, 0.6 * T)
    void finished().then(async () => {
      await Promise.race([p.shot.querySelector("img")?.decode().catch(() => {}), tick(60)])
      if (mine()) finish()
    })
  })
}

export function zoomIn(id: string, show: () => void) {
  const c = caught()
  finish()
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const p = zooms() && d ? partsFor(d, id, "nearest") : null
  if (!p) { show(); return }
  const P = pageRect(), bg = getComputedStyle(p.sheet).backgroundColor, h = heroOf(p), T = ZOOM.ms, t0 = performance.now()
  const main = document.querySelector<HTMLElement>("#main-scroll > main"), seen = main?.style.visibility ?? ""
  if (main) main.style.visibility = "hidden"
  let shown = false
  const showNow = () => {
    if (shown) return
    shown = true
    if (main) main.style.visibility = seen
    flushSync(() => { linger("tabs"); show() })
  }
  const mine = landing(() => { showNow(); relockScroll(); flushSync(() => linger(null)) })
  document.documentElement.dataset.tabZoom = ""
  hold(p.sheet, "pointerEvents", "none")
  hold(p.card, "visibility", "hidden")
  const from = c?.id === id ? c : null, r = from?.r ?? h.r
  flyHero(h, from?.win ?? h.S, P, [r, r, r, r], [0, 0, 0, 0])
  fade(h.face, { opacity: from?.face ?? 1 }, { opacity: 0 }, 0, 0.22 * T)
  if (h.ground) fade([h.ground], { opacity: from?.card ?? 1 }, { opacity: 0 }, 0, 0.3 * T)
  if (p.grid) fade([p.grid], { opacity: c?.grid ?? 1 }, { opacity: 0 }, 0, 0.3 * T)
  fade(p.heads, { opacity: c?.heads ?? 1 }, { opacity: 0 }, 0, 0.25 * T)
  const ground = groundOf(p.sheet, bg)
  if (c) { hold(ground, "opacity", String(c.sheet)); for (const el of p.chrome) hold(el, "opacity", String(c.chrome)) }
  setTimeout(() => {
    if (!mine()) return
    showNow()
    const left = Math.max(0.25 * T, T - (performance.now() - t0))
    fade(p.chrome, { opacity: c?.chrome ?? 1 }, { opacity: 0 }, 0, left)
    fade([ground], { opacity: c?.sheet ?? 1 }, { opacity: 0 }, 0, left)
    if (h.drawn) fade([h.el], { opacity: 1 }, { opacity: 0 }, 0, left + 0.15 * T)
    const through = h.drawn ? Promise.resolve() : settle(160).then(() => {
      if (!mine()) return
      const from = Math.max(0, 0.7 * T - (performance.now() - t0))
      fade([h.el], { opacity: 1 }, { opacity: 0 }, from, from + Math.max(0.25 * T, T - (performance.now() - t0) - from))
    })
    void through.then(finished).then(async () => {
      if (mine()) await settle(160)
      if (mine()) finish()
    })
  }, 0.55 * T)
}

export function zoomNew(from: Element | null, make: () => void, behind?: string | null) {
  finish()
  const b = from?.getBoundingClientRect()
  if (!zooms() || !b) { make(); return }
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const list = d?.querySelector<HTMLElement>("[data-tabs-pager]")
  const mine = landing(() => { if (list) { relockScroll(); flushSync(() => linger(null)) } })
  flushSync(() => { if (list) linger("tabs"); make() })
  const T = ZOOM.ms, mid = { x: b.left + b.width / 2, y: b.top + b.height / 2 }, k = 0.3
  const page = document.querySelector<HTMLElement>("#main-scroll > main")
  const grows = [document.querySelector<HTMLElement>("[data-phone-header]"), page].flatMap((el) => (el ? [{ el, r: el.getBoundingClientRect() }] : []))
  const grid = list?.querySelector<HTMLElement>("[data-tabs-grid]"), gr = grid?.getBoundingClientRect()
  const P = pageRect(), bg = d ? getComputedStyle(d).backgroundColor : ""
  if (page) { hold(page, "background", "var(--background)"); hold(page, "minHeight", "100dvh") }
  for (const { el, r } of grows) {
    scaled(el, r, mid, k, 1)
    fade([el], { opacity: 0 }, { opacity: 1 }, 0, 0.3 * T)
  }
  if (!list && behind) {
    const img = new Image()
    img.src = behind
    img.alt = ""
    img.setAttribute("aria-hidden", "true")
    Object.assign(img.style, { position: "fixed", left: `${P.left}px`, top: `${P.top}px`, width: `${P.width}px`, height: `${P.height}px`, objectFit: "cover", objectPosition: "top", zIndex: "-1", pointerEvents: "none" })
    document.body.append(img)
    undo.push(() => img.remove())
    scaled(img, P, { x: P.left + P.width / 2, y: P.top + P.height / 2 }, 1, 0.92)
    fade([img], { opacity: 1 }, { opacity: 0.4 }, 0, T)
  }
  if (d && list) {
    hold(d, "pointerEvents", "none")
    if (grid && gr) { scaled(grid, gr, { x: innerWidth / 2, y: innerHeight / 2 }, 1, 0.92); fade([grid], { opacity: 1 }, { opacity: 0 }, 0, 0.3 * T) }
    fade([...d.querySelectorAll<HTMLElement>("[data-tabs-header], [data-group-head]")], { opacity: 1 }, { opacity: 0 }, 0, 0.25 * T)
    fade([...d.querySelectorAll<HTMLElement>(":scope > header, :scope > footer")], { opacity: 1 }, { opacity: 0 }, 0, 0.35 * T)
    fade([groundOf(d, bg)], { opacity: 1 }, { opacity: 0 }, 0, 0.3 * T)
    document.documentElement.dataset.tabZoom = ""
  }
  void finished().then(() => { if (mine()) finish() })
}

export function slide(dir: -1 | 1, dragged = 0, reset?: () => void) {
  run(dir < 0 ? "back" : "forward", () => new Promise<void>((done) => {
    reset?.()
    addEventListener("popstate", () => done(), { once: true })
    setTimeout(done, 400) // no popstate: the browser had nowhere to go
    history.go(dir)
  }), () => {
    const st = document.documentElement.style, w = innerWidth, left = Math.abs(dragged) / w
    st.setProperty("--mto", `${dir < 0 ? w - dragged : -w - dragged}px`)
    st.setProperty("--mfrom", `${(dir < 0 ? -1 : 1) * w * 0.3 * (1 - left)}px`)
  })
}

export function step(dir: -1 | 1, change: () => void) {
  run(dir < 0 ? "back" : "forward", change, () => {
    const st = document.documentElement.style, w = innerWidth
    st.setProperty("--mto", `${dir < 0 ? w : -w}px`)
    st.setProperty("--mfrom", `${(dir < 0 ? -1 : 1) * w * 0.3}px`)
  })
}
