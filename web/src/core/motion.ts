// Phones: tabs and Back move like a browser's (a page shrinks into its card, Back slides away). Back with the View
// Transitions API and index.css's `html[data-motion]` rules: without it (iOS < 18) or with Reduce motion, instant.
import { flushSync } from "react-dom"
import { relockScroll } from "@/core/pagelock"
import { cell } from "@/core/signal"

type Kind = "back" | "forward"

/** Whether changes animate: the API is there, and the user hasn't asked for less motion. */
const moves = () =>
  typeof document !== "undefined" && typeof document.startViewTransition === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches

const VARS = ["--mto", "--mfrom"]
let running: ViewTransition | null = null

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms))
/** Let the change draw: React's render, then what loads right after (a file's text, marked aria-busy while it comes),
 *  for at most `cap` ms (the screen holds its last picture meanwhile, so not long). */
async function settle(cap = 220) {
  await tick()
  const end = performance.now() + cap
  while (performance.now() < end && document.querySelector("main [aria-busy=true]")) await tick(16)
}

/** Run `change` as a transition of `kind`; `before` sets what's known from the screen as it is. */
function run(kind: Kind, change: () => void | Promise<void>, before?: () => void) {
  if (!moves()) { void change(); return }
  // One at a time: a tap during one jumps it to its end.
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

/** A spring like SwiftUI's, from rest: `response` its period (s), `damping` 1 to stop dead at its place (less overshoots).
 *  `at(t)`: how far along t s in; `ms`: when it's within 0.2% of its place; `easing`: as a CSS `linear()`. */
export type Spring = { at: (t: number) => number; ms: number; easing: string }
export function spring(response = 0.3, damping = 1): Spring {
  const w = (2 * Math.PI) / response, z = damping
  // How far it still has to go at t (1 at the start).
  let left: (t: number) => number
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z), b = (z * w) / wd
    left = (t) => Math.exp(-z * w * t) * (Math.cos(wd * t) + b * Math.sin(wd * t))
  } else left = (t) => Math.exp(-w * t) * (1 + w * t)
  let ms = 1
  for (let t = 0; t < 3000; t++) if (Math.abs(left(t / 1000)) > 0.002) ms = t + 1
  const at = (t: number) => (t * 1000 >= ms ? 1 : 1 - left(t))
  const v = `linear(${Array.from({ length: 49 }, (_, i) => +at((ms * i) / 48000).toFixed(4)).join(", ")})`
  const easing = typeof CSS !== "undefined" && CSS.supports("transition-timing-function", v) ? v : "cubic-bezier(.2, .9, .1, 1)"
  return { at, ms, easing }
}

/** Whether the tab list zooms: Web Animations are there, and the user hasn't asked for less motion. */
export const zooms = () =>
  typeof document !== "undefined" && typeof document.documentElement.animate === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches

// The page shrinks into its card (a copy of it, the hero), the cards around fade in. Only transforms and opacity move
// (iOS runs them off the main thread), and only the hero is scaled up: iOS drops the tiles of a big scaled-up layer.
const ZOOM = spring(0.3, 1)
let zooming: Animation[] = []
let landed: (() => void) | null = null
/** Styles a zoom set for its length, put back at its end. */
let undo: (() => void)[] = []
function hold(el: HTMLElement, prop: "opacity" | "visibility" | "pointerEvents" | "background" | "minHeight", v: string) {
  const was = el.style[prop]
  el.style[prop] = v
  undo.push(() => { el.style[prop] = was })
}
/** This zoom's end, `done` (its animations go then); whether it's still this one's. */
function landing(done: () => void) {
  landed = done
  return () => landed === done
}
/** A zoom still going jumps to its end (a tap during one). */
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

// The tab list's sheet kept on screen after the address has left it, while a page grows out of it (App reads it).
const lingering = cell<string | null>(null)
const linger = lingering.set
export const useLingeringSheet = lingering.use

/** Where the page shows (what a card's picture is of): between the header and the bar. Its layout sizes, so a page a
 *  finger has shrunk still says where it is unshrunk. */
export function pageRect() {
  const top = document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0
  const bar = document.querySelector<HTMLElement>("[data-phone-bar]")
  const bottom = bar ? innerHeight - bar.offsetHeight : innerHeight
  return new DOMRect(0, top, innerWidth, Math.max(1, bottom - top))
}
/** Cards are the page's shape: their pictures line up with it when zoomed to it. */
function pageShape() {
  const r = pageRect()
  document.documentElement.style.setProperty("--tab-aspect", `${r.width} / ${r.height}`)
}

/** The parts of a zoom: the card (a tab's, or its picture in a group's) and its picture box (`shot`), the sheet and its
 *  scroller, the cards' grid, the list's top lines and the sheet's bars. */
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

/** The hero: a copy of the card in the list's scroller, so it scrolls and clips with the list. Its picture box (`win`) is
 *  stretched to the page by its transform; the picture (`inner`) and the name (`face`) are unstretched by theirs. */
type Hero = { el: HTMLElement; win: HTMLElement; inner: HTMLElement; face: HTMLElement[]; ground: HTMLElement | null; S: DOMRect; r: number; gr: number; drawn: boolean }
function heroOf(p: Parts): Hero {
  // All read before anything is written: a read after a write lays the whole list out again, on the tap's time.
  const c = p.card.getBoundingClientRect(), S = p.shot.getBoundingClientRect(), sc = p.scroller.getBoundingClientRect()
  const left = c.left - sc.left + p.scroller.scrollLeft, top = c.top - sc.top + p.scroller.scrollTop
  const tops = [...p.card.children].map((k) => k.getBoundingClientRect().top)
  const radius = (x: Element | null) => (x ? parseFloat(getComputedStyle(x).borderTopLeftRadius) || 0 : 0)
  const r = radius(p.shot), gr = radius(p.card.querySelector("[data-card-ground]"))
  const el = p.card.cloneNode(true) as HTMLElement
  const win = p.card === p.shot ? el : el.querySelector<HTMLElement>("[data-tab-shot]")!
  const ground = el.querySelector<HTMLElement>("[data-card-ground]")
  // Each part of the name kept on the picture's top edge as it's unstretched.
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
    // (no aspect-ratio: WebKit would widen it to its content's width)
    width: `${c.width}px`, height: `${c.height}px`, aspectRatio: "auto", minWidth: "0", margin: "0", zIndex: "30", pointerEvents: "none", transition: "none", scale: "none", opacity: "1",
    transformOrigin: `${S.left - c.left}px ${S.top - c.top}px`,
  })
  p.scroller.append(el)
  undo.push(() => el.remove())
  return { el, win, inner, face, ground, S, r, gr, drawn }
}

/** A copy of a card made inert and unmarked: nothing in it is found, focused or read out as the card. */
export function unmark(copy: HTMLElement) {
  copy.inert = true
  for (const x of [copy, ...copy.querySelectorAll("[data-tab-card], [data-tab-shot], [data-tab-pic], [data-tab-picture], [data-tab-mini], [data-card-ground], [id]")])
    for (const a of ["data-tab-card", "data-tab-shot", "data-tab-pic", "data-tab-picture", "data-tab-mini", "data-card-ground", "id"]) x.removeAttribute(a)
}

const go = (el: Element, keys: Keyframe[], o: KeyframeAnimationOptions) => { const a = el.animate(keys, o); zooming.push(a); return a }
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
/** The hero's moves over a zoom: its picture box from over `A` (corners `ra`: tl, tr, br, bl) to over `B` (`rb`).
 *  Keyframes at the spring's points, so the parts' transforms (each its own) stay in step. */
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
  // (corners: not something iOS moves off the main thread, so apart from the transforms, which stay right without them)
  go(h.win, keys.win, o)
  if (h.ground) go(h.ground, keys.ground, o)
}
/** Faded plainly from `a` to `b` between `from` and `to` ms into the zoom (a spring's overshoot would flash it). */
function fade(els: Element[], a: Keyframe, b: Keyframe, from: number, to: number) {
  for (const el of els) go(el, [a, b], { delay: Math.max(0, from), duration: Math.max(1, to - Math.max(0, from)), easing: "linear", fill: "both" })
}
/** `el` moved along the zoom's spring: `frame(p)` as it goes from 0 to 1, at its points, linear between (what iOS can run
 *  off the main thread, as it can't a `linear()` easing). */
function sprung(el: Element, frame: (p: number) => Keyframe, n = 30) {
  go(el, Array.from({ length: n + 1 }, (_, i) => ({ ...frame(i === n ? 1 : ZOOM.at((ZOOM.ms * i) / n / 1000)), offset: i / n })), { duration: ZOOM.ms, easing: "linear", fill: "both" })
}
/** Scaled from `a` to `b` about the screen's point `mid` (`el` is at `r`), on the zoom's spring. */
function scaled(el: HTMLElement, r: DOMRect, mid: { x: number; y: number }, a: number, b: number) {
  const transformOrigin = `${mid.x - r.left}px ${mid.y - r.top}px`
  sprung(el, (p) => ({ transformOrigin, transform: `scale(${lerp(a, b, p)})` }))
}
/** The sheet's ground (its colour, `bg`) as a layer of its own, so it fades by opacity (the sheet's own colour can't
 *  move off the main thread): the sheet clear meanwhile. */
function groundOf(sheet: HTMLElement, bg: string) {
  const g = document.createElement("div")
  Object.assign(g.style, { position: "absolute", inset: "0", pointerEvents: "none", background: bg })
  sheet.prepend(g)
  undo.push(() => g.remove())
  hold(sheet, "background", "transparent")
  return g
}

/** The sheet in the list once it's drawn (DetailSheet opens it in an effect): checked again each frame, before it's
 *  painted, for a few. */
function whenOpen(id: string, then: (p: Parts | null) => void, tries = 6) {
  const d = document.querySelector("dialog[open]")
  const p = d && partsFor(d, id, "center")
  if (p || !tries) return then(p ?? null)
  requestAnimationFrame(() => whenOpen(id, then, tries - 1))
}
const finished = () => Promise.all(zooming.map((a) => a.finished)).then(() => {}, () => {})

/** The tab list opening, while it does: what a tap on Done or a card turns around from. */
let opening: { id: string; h: Hero; ground: HTMLElement; p: Parts } | null = null
/** Where an opening is, caught midway: its picture's box and corners, the list's scale, how far each part has faded in. */
type Caught = { id: string; win: DOMRect; r: number; face: number; card: number; sheet: number; grid: number; heads: number; chrome: number }
function caught(): Caught | null {
  const o = opening
  if (!o) return null
  const at = (el?: Element | null) => (el ? +getComputedStyle(el).opacity : 1)
  const win = o.h.win.getBoundingClientRect(), P = pageRect()
  const k = Math.min(1, Math.max(0, (P.width - win.width) / Math.max(1, P.width - o.h.S.width)))
  return { id: o.id, win, r: o.h.r * k, face: at(o.h.face[0]), card: at(o.h.ground), sheet: at(o.ground), grid: at(o.p.grid), heads: at(o.p.heads[0]), chrome: at(o.p.chrome[0]) }
}

/** Open the tab list: the page shrinks into its card. `page`: where a finger has carried the page (pageLift.ts),
 *  `reset` puts it back, once the list covers it. */
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
    // The hero is the page now: the page itself would show through the list as it fades in, twice over.
    const main = document.querySelector<HTMLElement>("#main-scroll > main")
    if (main) hold(main, "visibility", "hidden")
    // (its tap target stays: a tap where it's landing takes the page back)
    const tap = p.card.querySelector<HTMLElement>(":scope > button")
    if (tap) hold(tap, "visibility", "visible")
    // A page a finger has shrunk has its bottom corners rounded (index.css' data-page-lift).
    const lr = page ? 28 * (page.width / P.width) : 0
    flyHero(h, page ?? P, h.S, [0, 0, lr, lr], [h.r, h.r, h.r, h.r])
    fade([ground], { opacity: 0 }, { opacity: 1 }, 0, 0.3 * T)
    fade(p.chrome, { opacity: 0 }, { opacity: 1 }, 0.05 * T, 0.4 * T)
    fade(p.heads, { opacity: 0 }, { opacity: 1 }, 0.1 * T, 0.45 * T)
    if (p.grid) fade([p.grid], { opacity: 0 }, { opacity: 1 }, 0.05 * T, 0.45 * T)
    fade(h.face, { opacity: 0 }, { opacity: 1 }, 0.3 * T, 0.65 * T)
    if (h.ground) fade([h.ground], { opacity: 0 }, { opacity: 1 }, 0.25 * T, 0.6 * T)
    void finished().then(async () => {
      // The card's own picture drawn before it takes the hero's place.
      await Promise.race([p.shot.querySelector("img")?.decode().catch(() => {}), tick(60)])
      if (mine()) finish()
    })
  })
}

/** Leave the tab list for tab `id` (`show` it): its card grows into the page at once, the page drawn under it as it
 *  lands (a slow one holds up nothing that moves). Tapped while the list opens, it turns around from where it got to. */
export function zoomIn(id: string, show: () => void) {
  const c = caught()
  finish()
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const p = zooms() && d ? partsFor(d, id, "nearest") : null
  if (!p) { show(); return }
  const P = pageRect(), bg = getComputedStyle(p.sheet).backgroundColor, h = heroOf(p), T = ZOOM.ms, t0 = performance.now()
  // (the page under the sheet, hidden till it's the one shown: a sheet caught opening is still see-through)
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
  // (an opening caught midway: the sheet's bars and ground stay as faded in as they'd got, till they go)
  if (c) { hold(ground, "opacity", String(c.sheet)); for (const el of p.chrome) hold(el, "opacity", String(c.chrome)) }
  // Within a few px of the page by then: were the main thread to stall drawing it, nothing visible would stop.
  setTimeout(() => {
    if (!mine()) return
    showNow()
    // The sheet's bars and ground go once the page is there to show, by the time the card lands.
    const left = Math.max(0.25 * T, T - (performance.now() - t0))
    fade(p.chrome, { opacity: c?.chrome ?? 1 }, { opacity: 0 }, 0, left)
    fade([ground], { opacity: c?.sheet ?? 1 }, { opacity: 0 }, 0, left)
    // A drawn stand-in isn't the page: the page comes through it.
    if (h.drawn) fade([h.el], { opacity: 1 }, { opacity: 0 }, 0, left + 0.15 * T)
    void finished().then(async () => {
      // The page drawn under the hero (a file's text loads), then the sheet goes.
      if (mine()) await settle(160)
      if (mine()) finish()
    })
  }, 0.55 * T)
}

/** A new tab, grown out of the + that made it (`from`, the button): from the tab list, the list fades back as it does;
 *  from the bar, the page left (its picture, `behind`) sinks back under it. */
export function zoomNew(from: Element | null, make: () => void, behind?: string | null) {
  finish()
  const b = from?.getBoundingClientRect()
  if (!zooms() || !b) { make(); return }
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const list = d?.querySelector<HTMLElement>("[data-tabs-pager]")
  const mine = landing(() => { if (list) { relockScroll(); flushSync(() => linger(null)) } })
  flushSync(() => { if (list) linger("tabs"); make() })
  const T = ZOOM.ms, mid = { x: b.left + b.width / 2, y: b.top + b.height / 2 }, k = 0.3
  // (all read before anything is written: heroOf's why)
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

/** Back (-1) or Forward (1): the page slides off to the right (or left), the one before (or after) in from the other
 *  side. `dragged`: how far the page has already been carried (its picture is taken there). */
export function slide(dir: -1 | 1, dragged = 0, reset?: () => void) {
  run(dir < 0 ? "back" : "forward", () => new Promise<void>((done) => {
    reset?.()
    // The change is the entry coming back; the page drawn for it a moment later (settle).
    addEventListener("popstate", () => done(), { once: true })
    setTimeout(done, 400) // the browser had nowhere to go
    history.go(dir)
  }), () => {
    const st = document.documentElement.style, w = innerWidth, left = Math.abs(dragged) / w
    // The page goes the rest of the way; the other comes from a third of the way out, as far along as the finger got.
    st.setProperty("--mto", `${dir < 0 ? w - dragged : -w - dragged}px`)
    st.setProperty("--mfrom", `${(dir < 0 ? -1 : 1) * w * 0.3 * (1 - left)}px`)
  })
}
