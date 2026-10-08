// Phones: tabs and Back move like a browser's (a page shrinks into its card, Back slides away). Back with the View
// Transitions API and index.css's `html[data-motion]` rules: without it (iOS < 18) or with Reduce motion, instant.
import { useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { relockScroll } from "@/core/pagelock"

type Kind = "back" | "forward"

/** Whether changes animate: the API is there, and the user hasn't asked for less motion. */
export const moves = () =>
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

/** A spring as a CSS easing (`linear()`, sampled over `settle` s, when it's within 1% of its place): what the tab list's
 *  zoom and its cards move with, like UIKit's. `damping` < 1 overshoots. The ease where `linear()` isn't known. */
export function spring(damping = 0.74, settle = 0.3) {
  const w = 4.6 / (damping * settle), wd = w * Math.sqrt(1 - damping * damping)
  const at = (t: number) => 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t))
  const v = `linear(${Array.from({ length: 41 }, (_, i) => +at((settle * i) / 40).toFixed(4)).join(", ").replace(/[^,]+$/, "1")})`
  return typeof CSS !== "undefined" && CSS.supports("transition-timing-function", v) ? v : "cubic-bezier(.2, .9, .1, 1)"
}

/** Whether the tab list zooms: Web Animations are there, and the user hasn't asked for less motion. */
export const zooms = () =>
  typeof document !== "undefined" && typeof document.documentElement.animate === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches

// The tab list opens and closes like Chrome's and Safari's: one picture of the page (the hero) flies between the page
// and its card on a uniform scale, its bottom clipped to the card's shape; the cards around settle in (or out) a little,
// the sheet's ground and bars fade. Nothing is ever scaled up but the hero: iOS drops the tiles of a big scaled layer.
const OPEN = { duration: 380, easing: spring(0.96, 0.38), fill: "both" } as const
const SHOW = { duration: 460, easing: spring(0.86, 0.46), fill: "both" } as const
/** How far the cards around are drawn back (the list settling in as the page shrinks into its card). */
const BACK = 0.92
let zooming: Animation[] = []
let landed: (() => void) | null = null
/** Styles a zoom set for its length, put back at its end. */
let undo: (() => void)[] = []
function hold(el: HTMLElement, prop: "overflow" | "zIndex" | "visibility" | "pointerEvents", v: string) {
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
  done?.()
  delete document.documentElement.dataset.tabZoom
  for (const a of zooming) a.cancel()
  zooming = []
  for (const u of undo) u()
  undo = []
}

// The tab list's sheet kept on screen after the address has left it, while a page grows out of it (App reads it).
let lingering: string | null = null
const lingerers = new Set<() => void>()
function linger(path: string | null) {
  lingering = path
  for (const f of lingerers) f()
}
export const useLingeringSheet = () =>
  useSyncExternalStore((f) => { lingerers.add(f); return () => { lingerers.delete(f) } }, () => lingering)

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

/** The parts of a zoom: the card's picture box (`shot`, hidden while the hero stands in for it) and picture, the card's
 *  face (name, ring, X), the list around it (the other cards, the top line), the sheet's bars. */
type Parts = { sheet: HTMLElement; shot: HTMLElement; pic: HTMLElement; face: HTMLElement[]; around: HTMLElement[]; chrome: HTMLElement[] }
function partsFor(sheet: ParentNode, id: string, block: ScrollLogicalPosition): Parts | null {
  const shot = sheet.querySelector<HTMLElement>(`[data-tab-row="${CSS.escape(id)}"] [data-tab-shot], [data-tab-mini="${CSS.escape(id)}"]`)
  const pic = shot?.querySelector<HTMLElement>("[data-tab-pic]")
  const list = shot?.closest<HTMLElement>("[data-tabs-pager]"), dialog = shot?.closest<HTMLElement>("dialog")
  const cell = shot?.closest<HTMLElement>("[data-tab-row], [data-group-card]")
  if (!shot || !pic || !list || !dialog || !cell) return null
  cell.scrollIntoView({ block })
  const face: HTMLElement[] = []
  for (let el: HTMLElement = shot; el !== cell && el.parentElement; el = el.parentElement)
    for (const sib of el.parentElement.children) if (sib !== el && sib instanceof HTMLElement) face.push(sib)
  const around = [...list.querySelectorAll<HTMLElement>("[data-tabs-header], [data-group-head], [data-tab-row], [data-group-card]")].filter((el) => el !== cell)
  const chrome = [...dialog.querySelectorAll<HTMLElement>(":scope > header, :scope > footer")]
  return { sheet: dialog, shot, pic, face, around, chrome }
}

/** The hero: the card's picture at the page's size (`page`), in the sheet over the list. The iPhone app's picture of the
 *  page, decoded before it's shown (`ready`), else the card's drawn stand-in (`drawn`), scaled up to the page. */
function heroFor(p: Parts, page: DOMRect) {
  const d = p.sheet.getBoundingClientRect()
  const el = document.createElement("div")
  el.setAttribute("aria-hidden", "true")
  el.dataset.tabHero = ""
  Object.assign(el.style, {
    position: "fixed", left: `${page.left - d.left}px`, top: `${page.top - d.top}px`, width: `${page.width}px`, height: `${page.height}px`,
    overflow: "hidden", pointerEvents: "none", zIndex: "40", transformOrigin: "0 0", background: "var(--background)", opacity: "0",
  })
  const img = p.pic.querySelector<HTMLImageElement>("img[data-tab-picture]")
  let ready: Promise<unknown> = Promise.resolve()
  if (img) {
    const i = new Image()
    i.alt = ""
    i.src = img.currentSrc || img.src
    Object.assign(i.style, { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" })
    el.append(i)
    ready = i.decode().catch(() => {})
  } else {
    const c = p.pic.cloneNode(true) as HTMLElement, w = p.pic.offsetWidth || 1
    c.removeAttribute("data-tab-pic")
    Object.assign(c.style, { position: "absolute", left: "0", top: "0", right: "auto", width: `${w}px`, transformOrigin: "0 0", transform: `scale(${page.width / w})`, borderRadius: "0" })
    el.append(c)
  }
  p.sheet.append(el)
  undo.push(() => el.remove())
  return { el, drawn: !img, ready: Promise.race([ready, tick(150)]) }
}

/** Where the hero is on the page (at `from`: a page a finger has shrunk, else the page itself) and in its card. */
function frames(p: Parts, page: DOMRect, from: DOMRect = page) {
  const pr = p.pic.getBoundingClientRect(), sr = p.shot.getBoundingClientRect()
  const k = pr.width / page.width, s = from.width / page.width
  const r = parseFloat(getComputedStyle(p.shot).borderTopLeftRadius) || 0
  // A shrunk page's bottom corners are rounded (index.css' data-page-lift).
  const lr = from === page ? 0 : 28 / s
  return {
    onPage: { transform: `translate(${from.left - page.left}px, ${from.top - page.top}px) scale(${s})`, clipPath: `inset(0px 0px 0px 0px round 0px 0px ${lr}px ${lr}px)` },
    inCard: { transform: `translate(${pr.left - page.left}px, ${pr.top - page.top}px) scale(${k})`, clipPath: `inset(0px 0px ${Math.max(0, page.height - sr.height / k)}px 0px round ${r / k}px ${r / k}px ${r / k}px ${r / k}px)` },
    // The hero card's middle: what the cards around are drawn back towards.
    mid: { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 },
  }
}

const go = (el: Element, keys: Keyframe[], o: KeyframeAnimationOptions) => { const a = el.animate(keys, o); zooming.push(a); return a }
/** Faded plainly (a spring's overshoot would flash it) from `a` to `b` over `[x, y]` of the way. */
function fade(els: Element[], a: Keyframe, b: Keyframe, [x, y]: number[], o: KeyframeAnimationOptions) {
  for (const el of els) go(el, [{ ...a, offset: 0 }, { ...a, offset: x }, { ...b, offset: y }, { ...b, offset: 1 }], { ...o, easing: "linear" })
}
/** A card around, as it is and drawn back towards `mid` (a scale of BACK there): one origin for both, or it drifts. */
function backFrames(el: HTMLElement, mid: { x: number; y: number }): [Keyframe, Keyframe] {
  const r = el.getBoundingClientRect(), transformOrigin = `${mid.x - r.left}px ${mid.y - r.top}px`
  return [{ transformOrigin, transform: "none" }, { transformOrigin, transform: `scale(${BACK})` }]
}
const ground = (p: Parts) => getComputedStyle(p.sheet).backgroundColor

/** The sheet in the list once it's drawn (DetailSheet opens it in an effect): checked again each frame, before it's
 *  painted, for a few. */
function whenOpen(id: string, then: (p: Parts | null) => void, tries = 6) {
  const d = document.querySelector("dialog[open]")
  const p = d && partsFor(d, id, "center")
  if (p || !tries) return then(p ?? null)
  requestAnimationFrame(() => whenOpen(id, then, tries - 1))
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
    document.documentElement.dataset.tabZoom = ""
    const hero = heroFor(p, P), f = frames(p, P, page)
    hold(p.shot, "visibility", "hidden")
    // Each part's first frame now, before it's painted; all of them go once the picture is decoded.
    const bg = ground(p)
    fade([p.sheet], { backgroundColor: "transparent" }, { backgroundColor: bg }, [0, 0.15], OPEN)
    fade(p.chrome, { opacity: 0 }, { opacity: 1 }, [0.1, 0.5], OPEN)
    fade(p.face, { opacity: 0 }, { opacity: 1 }, [0.45, 1], OPEN)
    for (const el of p.around) go(el, backFrames(el, f.mid).reverse(), OPEN)
    fade(p.around, { opacity: 0 }, { opacity: 1 }, [0.05, 0.55], OPEN)
    go(hero.el, [f.onPage, f.inCard], OPEN)
    for (const a of zooming) a.pause()
    void hero.ready.then(() => {
      if (!mine()) return
      hero.el.style.opacity = "1"
      // A drawn stand-in isn't the page: it comes in over it as the page goes.
      if (hero.drawn) fade([hero.el], { opacity: 0 }, { opacity: 1 }, [0, 0.2], OPEN)
      for (const a of zooming) a.play()
      void Promise.all(zooming.map((a) => a.finished)).then(async () => {
        // The card's own picture drawn before it takes the hero's place.
        await Promise.race([p.pic.querySelector("img")?.decode().catch(() => {}), tick(100)])
        if (mine()) finish()
      }, () => {})
    })
  })
}

/** Leave the tab list for tab `id` (`show` it): its card grows into the page. The sheet stays on screen (lingers) over
 *  the page shown under it until the card covers it. */
export async function zoomIn(id: string, show: () => void) {
  finish()
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const p = zooms() && d ? partsFor(d, id, "nearest") : null
  if (!p) { show(); return }
  const P = pageRect(), hero = heroFor(p, P), f = frames(p, P)
  const mine = landing(() => { relockScroll(); flushSync(() => linger(null)) })
  await hero.ready
  if (!mine()) return
  flushSync(() => { linger("tabs"); show() })
  hold(p.sheet, "pointerEvents", "none")
  hold(p.shot, "visibility", "hidden")
  hero.el.style.opacity = "1"
  const bg = ground(p)
  go(hero.el, [f.inCard, f.onPage], SHOW)
  if (hero.drawn) fade([hero.el], { opacity: 1 }, { opacity: 0 }, [0.7, 1], SHOW)
  fade(p.face, { opacity: 1 }, { opacity: 0 }, [0, 0.25], SHOW)
  for (const el of p.around) go(el, backFrames(el, f.mid), SHOW)
  fade(p.around, { opacity: 1 }, { opacity: 0 }, [0, 0.45], SHOW)
  fade(p.chrome, { opacity: 1 }, { opacity: 0 }, [0.45, 0.85], SHOW)
  fade([p.sheet], { backgroundColor: bg }, { backgroundColor: "transparent" }, [0.6, 1], SHOW)
  document.documentElement.dataset.tabZoom = ""
  await Promise.all(zooming.map((a) => a.finished)).catch(() => {})
  // The page drawn under the hero (a file's text loads), then the sheet goes.
  if (mine()) await settle(160)
  if (mine()) finish()
}

/** A new tab, grown out of the + that made it (`from`, the button): from the tab list, the list fades back as it does. */
export function zoomNew(from: Element | null, make: () => void) {
  finish()
  const b = from?.getBoundingClientRect()
  if (!zooms() || !b) { make(); return }
  const d = document.querySelector<HTMLElement>("dialog[open]")
  const list = d?.querySelector<HTMLElement>("[data-tabs-pager]")
  const mine = landing(() => { if (list) { relockScroll(); flushSync(() => linger(null)) } })
  flushSync(() => { if (list) linger("tabs"); make() })
  const T = { duration: 340, easing: spring(0.96, 0.34), fill: "both" } as const
  const mid = { x: b.left + b.width / 2, y: b.top + b.height / 2 }, k = 0.3
  for (const el of [document.querySelector("[data-phone-header]"), document.querySelector("#main-scroll > main")]) {
    if (!(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect(), origin = `${mid.x - r.left}px ${mid.y - r.top}px`
    go(el, [{ transformOrigin: origin, transform: `scale(${k})` }, { transformOrigin: origin, transform: "none" }], T)
    fade([el], { opacity: 0 }, { opacity: 1 }, [0, 0.35], T)
  }
  if (d && list) {
    hold(d, "pointerEvents", "none")
    const around = [...list.querySelectorAll<HTMLElement>("[data-tabs-header], [data-group-head], [data-tab-row], [data-group-card]")]
    const centre = { x: innerWidth / 2, y: innerHeight / 2 }
    for (const el of around) go(el, backFrames(el, centre), T)
    fade(around, { opacity: 1 }, { opacity: 0 }, [0, 0.3], T)
    fade([...d.querySelectorAll<HTMLElement>(":scope > header, :scope > footer")], { opacity: 1 }, { opacity: 0 }, [0, 0.35], T)
    fade([d], { backgroundColor: getComputedStyle(d).backgroundColor }, { backgroundColor: "transparent" }, [0, 0.3], T)
    document.documentElement.dataset.tabZoom = ""
  }
  void Promise.all(zooming.map((a) => a.finished)).then(() => {
    if (mine()) finish()
  }, () => {})
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
