// Sidebar panels in motion (core/animation.ts' timing): one dragged by its heading lifts whole, a picture of it
// following the pointer, and settles into its slot; one folded closes under its heading. Transforms and clips only.
import { flushSync } from "react-dom"
import { timing } from "@/core/animation"
import { getDrag, onDrag, type Drag } from "@/core/drag"
import { PANES } from "@/core/drop"

// Lifted, a glass card with a light hairline; landing, its chrome dissolves into the plain list.
const SHADOW = "0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent), 0 14px 36px rgb(0 0 0 / 0.2), 0 3px 8px rgb(0 0 0 / 0.1)"
const FLAT = "0 0 0 1px transparent, 0 0 0 rgb(0 0 0 / 0), 0 0 0 rgb(0 0 0 / 0)"
const LIFT = 1.02
const FOLD = "panel-fold"

const panelEl = (key: string, root: ParentNode = document) =>
  root.querySelector<HTMLElement>(`${root === document ? "[data-sidebar-body]" : ":scope"} > [data-panel="${CSS.escape(key)}"]`)

/** A copy of panel `el` to show in its place: nothing finds it as the panel (`data-panel` empty keeps its styles). */
function copyOf(el: HTMLElement) {
  const c = el.cloneNode(true) as HTMLElement
  c.dataset.panel = ""
  c.removeAttribute("data-slide")
  c.classList.remove("invisible")
  c.style.transform = ""; c.style.opacity = ""; c.style.visibility = ""
  for (const e of c.querySelectorAll("[id], [data-keyrow], [data-tip]")) { e.removeAttribute("id"); e.removeAttribute("data-keyrow"); e.removeAttribute("data-tip") }
  return c
}
/** Once the copy is in the page: scrolled as the panel is, its canvases drawn. */
function likeIt(c: HTMLElement, el: HTMLElement) {
  const from = [el, ...el.querySelectorAll("*")], to = [c, ...c.querySelectorAll("*")]
  if (from.length !== to.length) return
  from.forEach((f, i) => {
    const t = to[i]
    if (f.scrollTop || f.scrollLeft) { t.scrollTop = f.scrollTop; t.scrollLeft = f.scrollLeft }
    if (f instanceof HTMLCanvasElement && t instanceof HTMLCanvasElement) try { t.getContext("2d")?.drawImage(f, 0, 0) } catch { /* tainted */ }
  })
}

// ---------- the lifted panel ----------

/** A panel being dragged (or settling after): the real one, its picture (`ghost` follows the pointer, `card` lifts),
 *  where the pointer holds it, its height, and the last place the drag was over. */
type Lift = { key: string; el: HTMLElement; ghost: HTMLElement; card: HTMLElement; tag: HTMLElement; dx: number; dy: number; h: number
  over: string | null; to?: DOMRect; fading?: boolean; cancelled?: boolean }
let lift: Lift | null = null
let settling: Lift | null = null

/** The lifted panel's height: the room the other sidebar makes for it (its INCOMING). */
export const liftedHeight = () => lift?.h

function start(d: Drag) {
  finish()
  const key = d.item.panel!, el = panelEl(key), body = el?.parentElement
  if (!el || !body) return
  const r = el.getBoundingClientRect(), b = body.getBoundingClientRect()
  // From its first row in sight (a sidebar scrolling as one), as tall as it shows, a very tall one cut short.
  const top = Math.max(r.top, b.top), seen = Math.min(r.bottom, b.bottom) - top
  const h = Math.round(Math.min(seen, Math.max(160, innerHeight * 0.4)))
  const ghost = document.createElement("div")
  ghost.inert = true
  ghost.setAttribute("aria-hidden", "true")
  ghost.dataset.panelGhost = key
  ghost.className = "pointer-events-none fixed top-0 left-0 z-50 will-change-transform"
  ghost.style.width = `${r.width}px`
  const card = document.createElement("div")
  card.className = "rounded-[14px] bg-sidebar/85 text-foreground backdrop-blur-md transition-opacity duration-(--motion-fast) ease-(--ease-out)"
  card.style.boxShadow = SHADOW
  // (the panels' own rules: a heading's room above it in boxes of their own)
  const clip = document.createElement("div")
  clip.dataset.scroll = body.dataset.scroll
  clip.className = "overflow-hidden rounded-[14px]"
  clip.style.height = `${h}px`
  if (seen > h + 1) clip.style.maskImage = "linear-gradient(to bottom, #000 calc(100% - 48px), transparent)"
  const copy = copyOf(el)
  copy.style.marginTop = `${r.top - top}px`
  clip.append(copy); card.append(clip)
  // What a drop there does ("To the right sidebar"), on its corner.
  const tag = document.createElement("span")
  tag.hidden = true
  tag.className = "absolute -top-2.5 right-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow-sm"
  ghost.append(card, tag)
  document.body.append(ghost)
  likeIt(copy, el)
  lift = { key, el, ghost, card, tag, dx: d.x - r.left, dy: d.y - top, h, over: null }
  follow(d)
  card.style.transformOrigin = `${lift.dx}px ${lift.dy}px`
  card.style.transform = `scale(${LIFT})`
  const t = timing("spring")
  if (t.duration) card.animate([{ transform: "none", boxShadow: FLAT }, { transform: `scale(${LIFT})`, boxShadow: SHADOW }], t)
}

function follow(d: Drag) {
  const l = lift!
  l.ghost.style.transform = `translate(${d.x - l.dx}px, ${d.y - l.dy}px)`
  l.over = d.hit?.target ?? null
  // Over the panes it would open as a tab: the tab's picture shows instead (DragGhost).
  const away = l.over === PANES && !!d.item.to
  l.card.style.opacity = away ? "0" : ""
  l.ghost.toggleAttribute("data-drag-ghost", !away)
  const hint = l.over === PANES ? "" : d.hit?.hint ?? ""
  if (l.tag.textContent !== hint) { l.tag.textContent = hint; l.tag.hidden = !hint }
}

/** Let go: back into a sidebar (its new place, or home when the drag was cancelled), it settles there; taken elsewhere
 *  (opened as a tab, put in the top bar), its picture fades where it was let go. */
function end() {
  const l = lift!
  lift = null
  settling = l
  l.tag.hidden = true
  const into = l.cancelled || !l.over || l.over.startsWith("panels:") || l.over.startsWith("toggle:")
  if (!into || !timing().duration) return fade(l)
  // (the sidebars draw the drop, then call settle(); one that drew nothing new leaves it to the next frame)
  requestAnimationFrame(() => requestAnimationFrame(() => { if (settling === l && !l.to) fade(l) }))
}

/** After a sidebar draws (its layout effect): the panel let go flies from where its picture is into its place, or on to
 *  where it moved since. */
export function settle() {
  const l = settling
  if (!l || l.fading) return
  const el = panelEl(l.key)
  if (!el) return
  const r = el.getBoundingClientRect()
  if (l.to && el === l.el && Math.abs(r.top - l.to.top) < 0.5 && Math.abs(r.left - l.to.left) < 0.5) return
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || !r.width) return fade(l)
  if (el !== l.el) l.el.style.opacity = ""
  l.el = el
  el.style.opacity = "0"
  l.to = r
  const g = new DOMMatrixReadOnly(getComputedStyle(l.ghost).transform), c = getComputedStyle(l.card)
  const scale = new DOMMatrixReadOnly(c.transform).a || 1, shadow = c.boxShadow
  for (const a of [...l.ghost.getAnimations(), ...l.card.getAnimations()]) a.cancel()
  const to = `translate(${r.left}px, ${r.top}px)`
  l.ghost.style.transform = to
  l.card.style.transform = ""; l.card.style.boxShadow = FLAT
  const t = timing("spring")
  const fly = l.ghost.animate([{ transform: `translate(${g.m41}px, ${g.m42}px)` }, { transform: to }], t)
  l.card.animate([{ transform: `scale(${scale})`, boxShadow: shadow, borderRadius: "14px", backdropFilter: "blur(12px)" },
    { transform: "none", boxShadow: FLAT, borderRadius: "0px", backdropFilter: "blur(0px)" }], t)
  // Its corners square as it lands, its picture cut to the place it lands in.
  const clip = l.card.firstElementChild as HTMLElement
  const cut = Math.max(0, l.h - r.height)
  clip.animate([{ clipPath: "inset(0 0 0 0)", borderRadius: "14px" }, { clipPath: `inset(0 0 ${cut}px 0)`, borderRadius: "0px" }], { ...t, fill: "forwards" })
  fly.finished.then(() => { if (settling === l && l.to === r) finish() }, () => {})
}

function fade(l: Lift) {
  l.el.style.opacity = ""
  l.fading = true
  const t = timing("fast")
  if (!t.duration) return finish()
  for (const a of l.card.getAnimations()) a.cancel()
  l.card.animate([{ opacity: getComputedStyle(l.card).opacity, transform: `scale(${LIFT})` }, { opacity: 0, transform: "scale(0.96)" }], { ...t, fill: "forwards" })
    .finished.then(() => { if (settling === l) finish() }, () => {})
}

/** The settling panel in its place now, its picture gone. */
function finish() {
  const l = settling
  settling = null
  if (!l) return
  l.el.style.opacity = ""
  l.ghost.remove()
}

if (typeof window !== "undefined") {
  onDrag(() => {
    const d = getDrag()
    if (d && d.item.from === "panel" && d.item.drawn) { if (!lift) start(d); if (lift) follow(d) }
    else if (!d && lift) end()
  })
  // Escape puts it back wherever it is (heard before core/drag.ts, which ends the drag on it).
  addEventListener("keydown", (e) => { if (e.key === "Escape" && lift) lift.cancelled = true }, true)
}

// ---------- folding ----------

/** How much of `e` shows under its clip (its whole height without one). */
function shown(e: HTMLElement) {
  const h = e.getBoundingClientRect().height
  const m = /inset\(\S+ \S+ ([\d.]+)px/.exec(getComputedStyle(e).clipPath)
  return m ? h - parseFloat(m[1]) : h
}

/** Fold panel `key` of a sidebar's `body` to its heading or open it (`toggle` does it): what it draws closes or opens
 *  under its heading, the panels around moving in step; again midway, it turns back from where it is. */
export function foldPanel(body: HTMLElement | null, key: string, toggle: () => void) {
  const el = body && panelEl(key, body)
  const t = timing("spring")
  if (!body || !el || !t.duration) return toggle()
  const old = body.querySelector<HTMLElement>(":scope > [data-fold-shade]")
  const kids = [...body.children].filter((e): e is HTMLElement => e instanceof HTMLElement && e !== old)
  // Where everything is now, mid-slide too.
  const before = new Map(kids.map((k) => [k, k.getBoundingClientRect().top]))
  const from = old ?? el, top0 = from.getBoundingClientRect().top, seen = shown(from)
  for (const k of kids) for (const a of k.getAnimations()) if (a.id === FOLD) a.cancel()
  old?.remove()
  el.style.opacity = ""
  const folding = el.dataset.collapsed === undefined
  // Folding, what it draws goes at once: a copy of it closes in its place.
  const shade = folding ? copyOf(el) : null
  const full = el.offsetHeight
  if (shade) {
    const b = body.getBoundingClientRect()
    shade.dataset.foldShade = ""
    shade.setAttribute("aria-hidden", "true"); shade.inert = true
    Object.assign(shade.style, { position: "absolute", left: `${el.offsetLeft}px`, width: `${el.offsetWidth}px`, height: `${full}px`, margin: "0",
      top: `${top0 - b.top - body.clientTop + body.scrollTop}px`, pointerEvents: "none" })
    // (in the page before it folds: its rows scrolled as they are, which a folded panel forgets)
    body.append(shade)
    likeIt(shade, el)
  }
  flushSync(toggle)
  const top1 = el.getBoundingClientRect().top
  const moving = (k: HTMLElement, dy: number) => { if (Math.abs(dy) > 0.5) k.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { ...t, id: FOLD }) }
  for (const k of kids) if (k !== el && k.isConnected) moving(k, before.get(k)! - k.getBoundingClientRect().top)
  if (shade) {
    const h1 = el.offsetHeight
    // What it drew fades as it closes over its heading (drawn under it), the panels below sliding up under its edge.
    const a = shade.animate([{ transform: "none", clipPath: `inset(0 0 ${full - seen}px 0)`, opacity: 1 }, { transform: `translateY(${top1 - top0}px)`, clipPath: `inset(0 0 ${full - h1}px 0)`, opacity: 0 }], { ...t, id: FOLD, fill: "forwards" })
    a.finished.then(() => shade.remove(), () => {})
  } else {
    el.animate([{ transform: `translateY(${top0 - top1}px)`, clipPath: `inset(0 0 ${Math.max(0, el.offsetHeight - seen)}px 0)` }, { transform: "none", clipPath: "inset(0 0 0 0)" }], { ...t, id: FOLD })
  }
}
