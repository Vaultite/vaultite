// Tabs move as a browser's: a group folds by its tabs shrinking into its chip and opens by them growing out; new tabs
// grow in (springing), closed ones shrink away. Only what the user does moves: an agent's fold or a workspace just shows.
import { useLayoutEffect, useRef, type RefObject } from "react"
import { closeTab, groupOfTab, groups, layoutQuiet, mayClose, onWorkspaceChange, replacingWorkspace } from "@/core/workspace"
import type { Group } from "../../../core/layout.ts"
import { foldSet, handOverFrom, setById } from "@/core/tabsets"
import { moves, timing, type Pace } from "@/core/animation"
import { stir } from "@/core/tabline"

const still = () => !moves()

/** Along the bar (x) or down the panel (y): by where it's drawn. */
const axisOf = (el: HTMLElement) => (el.closest("[data-tab-bar]") ? "x" : "y")
/** The gap after it in its list, which it takes with it so nothing jumps when it goes. */
const gapOf = (el: HTMLElement) => {
  let p = el.parentElement
  while (p && getComputedStyle(p).display === "contents") p = p.parentElement
  if (!p) return 0
  const css = getComputedStyle(p)
  return parseFloat(axisOf(el) === "x" ? css.columnGap : css.rowGap) || 0
}

/** How an element is drawn along its list's axis: its size, the margin after it, its opacity. */
type Box = { size: number; margin: number; opacity: number }
/** As it's drawn now, mid-motion too, in its own CSS px: a phone's sidebar is zoomed (data-size-up), and its rows grew
 *  to their size on screen times that zoom, then snapped back. */
function drawnBox(el: HTMLElement): Box {
  const r = el.getBoundingClientRect(), css = getComputedStyle(el), x = axisOf(el) === "x"
  const seen = x ? r.width : r.height, own = x ? el.offsetWidth : el.offsetHeight
  const zoom = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom || (seen && own ? seen / own : 1)
  return { size: seen / zoom, margin: parseFloat(x ? css.marginRight : css.marginBottom) || 0, opacity: parseFloat(css.opacity) }
}
/** What runs on each tab now (squeeze), to turn it round from where it's got to. */
const running = new WeakMap<HTMLElement, Animation>()

/** `el` from `from` to its size (`out`: to nothing, taking the gap after it), clipped along the way it moves (a tab's line
 *  under it still shows), kept at its end till it's taken away (`cancel` puts it back as it was). */
function squeeze(el: HTMLElement, out: boolean, from?: Box, full: Box = drawnBox(el), pace: Pace = out ? "base" : "spring"): Animation {
  const x = axisOf(el) === "x", none: Box = { size: 0, margin: -gapOf(el), opacity: 0 }
  const frame = (b: Box) => (x ? { minWidth: `${b.size}px`, maxWidth: `${b.size}px`, marginRight: `${b.margin}px`, opacity: b.opacity }
    : { height: `${b.size}px`, marginBottom: `${b.margin}px`, opacity: b.opacity })
  el.style.clipPath = x ? "inset(-4px 0)" : "inset(0 -8px)"
  const a = el.animate([frame(from ?? (out ? full : none)), frame(out ? none : { ...full, margin: 0, opacity: 1 })], { ...timing(pace), fill: out ? "forwards" : "none" })
  running.set(el, a)
  stir(el)
  const done = () => { el.style.clipPath = ""; if (running.get(el) === a) running.delete(el) }
  a.addEventListener("cancel", done)
  if (!out) a.addEventListener("finish", done)
  return a
}
/** Elements turned round mid-motion, all at once: each from where it's drawn now, to nothing or to its size as laid out
 *  (measured with nothing moving, all before any starts: one moving would change the others' room). */
function turn(els: HTMLElement[], out: boolean, pace: Pace = "base") {
  const from = els.map(drawnBox)
  for (const e of els) running.get(e)?.cancel()
  const full = els.map(drawnBox)
  return els.map((e, i) => squeeze(e, out, from[i], full[i], pace))
}

// ---------- folding ----------

/** Tab groups folding (their tabs shrinking into the chip), till they're folded; `token`: this fold, not a later one. */
const folding = new Map<string, { els: HTMLElement[]; token: number; handBack?: () => void }>()
let tokens = 0
/** Tab groups opened by a click, and when: their tabs grow in as they're drawn. */
const opened = new Map<string, number>()

/** A tab group's chip and rows show its fold at once, as the click asks (its count, its line, its chevron): their CSS
 *  moves them (index.css, `data-set-moving`) while its tabs do. */
function showFold(id: string, open: boolean) {
  for (const h of document.querySelectorAll<HTMLElement>(`[data-set-chip="${id}"], [data-set-row="${id}"]`)) {
    h.setAttribute("aria-expanded", String(open))
    clearTimeout(Number(h.dataset.setMoving))
    h.dataset.setMoving = String(window.setTimeout(() => { delete h.dataset.setMoving }, timing("base").duration + 80))
    stir(h)
  }
}

/** Fold or open a tab group as the user does it (its chip or row clicked): its tabs shrink into it, then it folds; or
 *  they grow out of it. A click while it moves turns it round from where it's got to. */
export function foldSetMoving(id: string) {
  const where = setById(id)
  if (!where) return
  const going = folding.get(id)
  const open = going ? true : !!where.s.collapsed
  if (still()) { folding.delete(id); foldSet(id, !open); return }
  if (open) {
    showFold(id, true)
    // (turned round before it had folded: back from where they are)
    if (going) { folding.delete(id); turn(going.els.filter((e) => e.isConnected), false); going.handBack?.(); return }
    opened.set(id, performance.now())
    foldSet(id, false)
    return
  }
  const els = [...document.querySelectorAll<HTMLElement>(`[data-in-set="${id}"]`)].filter((e) => e.offsetParent !== null)
  if (!els.length) { foldSet(id, true); return }
  showFold(id, false)
  const handBack = handOverFrom(id)
  const token = ++tokens
  folding.set(id, { els, token, handBack })
  Promise.all(turn(els, true).map((a) => a.finished)).then(() => {
    if (folding.get(id)?.token !== token) return
    folding.delete(id)
    foldSet(id, true)
    // (folded, React takes them away, whenever it draws: left shrunk till then. Not folded after all: put back)
    if (!setById(id)?.s.collapsed) for (const e of els) running.get(e)?.cancel()
  }, () => {})
}

// ---------- tabs coming and going ----------

/** Tabs that came into the workspace just now, and when: opened one or two at a time, not a whole layout put in place
 *  (another workspace, another device's change). */
const born = new Map<string, number>()
let known = new Set<string>()
/** Every tab, and every tab group as `set:<id>` (a new one's chip comes in too: useSetIn). */
const ids = () => new Set(groups().flatMap((g) => [...g.tabs.map((t) => t.id), ...(g.sets ?? []).map((s) => `set:${s.id}`)]))
if (typeof window !== "undefined") {
  known = ids()
  onWorkspaceChange(() => {
    const now = ids(), fresh = [...now].filter((id) => !known.has(id))
    known = now
    if (replacingWorkspace()) return
    if (fresh.length && fresh.length <= 2) { const t = performance.now(); for (const id of fresh) born.set(id, t) }
  })
}
const recent = (t: number | undefined) => t !== undefined && performance.now() - t < 400

/** A tab's element grows in as it's drawn: a new tab (springing), or one of a group just opened (as the others fold). */
export function useGrowIn(ref: RefObject<HTMLElement | null>, tab: { id: string; set?: string }) {
  useLayoutEffect(() => {
    const el = ref.current
    const group = !!tab.set && recent(opened.get(tab.set))
    if (!el || still() || !(recent(born.get(tab.id)) || group)) return
    born.delete(tab.id)
    grow(el, group ? "base" : "spring")
  }, [])  // (on its first drawing only)
}
/** A tab group's chip or row, made just now: it comes in where it stays (its editor opens under it at once). */
export function useSetIn(ref: RefObject<HTMLElement | null>, id: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || still() || !recent(born.get(`set:${id}`))) return
    born.delete(`set:${id}`)
    const a = el.animate([{ opacity: 0, scale: "0.8 1", transformOrigin: "left" }, { opacity: 1, scale: "1", transformOrigin: "left" }], timing("spring"))
    return () => a.cancel()
  }, [])  // (on its first drawing only)
}
/** Tabs drawn in this commit, to grow in together once all are laid out (before the frame is drawn): measured one by
 *  one as each starts, the later ones would take the room the earlier ones haven't yet. */
const growing: { el: HTMLElement; pace: Pace }[] = []
function grow(el: HTMLElement, pace: Pace) {
  if (!growing.length) queueMicrotask(() => {
    const all = growing.splice(0).filter((g) => g.el.isConnected), full = all.map((g) => drawnBox(g.el))
    all.forEach((g, i) => squeeze(g.el, false, undefined, full[i], g.pace))
  })
  growing.push({ el, pace })
}

/** A tab, or a tab group's chip or row, gone from a tab bar or the Tabs panel however it went shrinks away: a copy, as
 *  React takes it out. Not one still there (a tab still in its pane: regrouped, folded; a group moved to another pane). */
export function useShrinkOut(ref: RefObject<HTMLElement | null>, what: { tab: string; pane: string } | { set: string }) {
  useLayoutEffect(() => {
    const el = ref.current
    const stays = () => ("set" in what ? !!setById(what.set) : groupOfTab(what.tab)?.id === what.pane)
    return () => {
      if (!el?.isConnected || still() || replacingWorkspace() || stays()) return
      const r = el.getBoundingClientRect(), size = axisOf(el) === "x" ? r.width : r.height
      if (size < 1) return
      const copy = el.cloneNode(true) as HTMLElement
      for (const e of [copy, ...copy.querySelectorAll("*")]) for (const a of OWN) e.removeAttribute(a)
      copy.querySelector("[data-tab-return]")?.remove()
      copy.inert = true
      // (its own width while it's beside the original in a row, gone once React has taken that out)
      Object.assign(copy.style, { pointerEvents: "none", flex: axisOf(el) === "x" ? `0 0 ${size}px` : "none" })
      el.after(copy)
      squeeze(copy, true).finished.then(() => copy.remove(), () => copy.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])  // (what it draws stays the same: a tab's id and pane are its key)
}
/** What makes an element the tab or group it draws, which its copy isn't. */
const OWN = ["data-tab-id", "data-open-tab", "data-slide", "data-select-key", "data-in-set", "data-selected", "data-set-chip", "data-set-row"]

/** Close a tab from a list that doesn't take its rows away moving (the palette's tab search): its row shrinks away as
 *  it closes. One whose view asks first and says no grows back from where it had got to. */
export function closeTabMoving(id: string, el: HTMLElement | null) {
  const g = groupOfTab(id)
  if (!g) return
  if (!el || still()) { closeTab(id); return }
  el.style.pointerEvents = "none"
  const a = squeeze(el, true), ok = mayClose(g.tabs.filter((t) => t.id === id))
  a.addEventListener("cancel", () => { el.style.pointerEvents = "" })
  // (closed once it has shrunk, so the list doesn't take it away mid-way; React takes it away whenever it draws)
  void Promise.resolve(ok).then((yes) => {
    if (!yes) { if (el.isConnected) turn([el], false); else a.cancel(); return }
    a.finished.then(() => closeTab(id, true), () => {})
  })
}

// ---------- tabs moving among themselves ----------

/** A pane's tabs' order and groups (not folds: those move by foldSetMoving). */
const drawnAs = (g: Group | undefined) => g ? `${g.tabs.map((t) => `${t.id}:${t.set ?? ""}`).join(",")}|${(g.sets ?? []).map((s) => s.id).join(",")}` : ""
const sameTabs = (a: Group, b: string) => a.tabs.map((t) => t.id).sort().join() === b.split("|")[0].split(",").map((x) => x.split(":")[0]).sort().join()

/** A pane's tabs (`box`'s `[data-slide]` items: the tab bar's, the Tabs panel's rows) moved among themselves, not opened
 *  or closed (grouped, ungrouped, moved by a menu or a drop) slide from where they were drawn to their new places. */
export function useReflow(box: RefObject<HTMLElement | null>, g: Group) {
  const shown = useRef(drawnAs(g)), was = useRef<Map<string, DOMRect> | null>(null)
  useLayoutEffect(() => onWorkspaceChange(() => {
    // (measured as the change is told, before React draws it: where each is on screen, a drag's preview included)
    const now = groups().find((x) => x.id === g.id), root = box.current
    was.current = null
    if (!now || !root || still() || replacingWorkspace() || layoutQuiet()) return
    if (drawnAs(now) === shown.current || !sameTabs(now, shown.current)) return
    was.current = new Map([...root.querySelectorAll<HTMLElement>("[data-slide]")].map((e) => [e.dataset.slide!, e.getBoundingClientRect()]))
  }), [box, g.id])
  useLayoutEffect(() => {
    shown.current = drawnAs(g)
    const from = was.current, root = box.current
    was.current = null
    if (!from || !root) return
    for (const e of root.querySelectorAll<HTMLElement>("[data-slide]")) {
      const a = from.get(e.dataset.slide!), b = e.getBoundingClientRect()
      if (!a || !b.width) continue
      const dx = a.left - b.left, dy = a.top - b.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      for (const x of e.getAnimations()) if ((x as CSSAnimation).id === "reflow") x.cancel()
      const anim = e.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], timing("spring"))
      anim.id = "reflow"
    }
  })
}
