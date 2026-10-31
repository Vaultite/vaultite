// Tabs move as a browser's: a group folds by its tabs shrinking into its chip and opens by them growing out; new tabs
// grow in (springing), closed ones shrink away. Only what the user does moves: an agent's fold or a workspace just shows.
import { useLayoutEffect, type RefObject } from "react"
import { closeTab, groupOfTab, groups, onWorkspaceChange, replacingWorkspace } from "@/core/workspace"
import { foldSet, setById } from "@/core/tabsets"
import { moves, timing } from "@/core/animation"

const still = () => !moves()

/** Along the bar (x) or down the panel (y): by where it's drawn. */
const axisOf = (el: HTMLElement) => (el.closest("[data-tab-bar]") ? "x" : "y")
/** The gap after it in its list, which it takes with it so nothing jumps when it goes. */
const gapOf = (el: HTMLElement) => {
  const p = el.parentElement
  if (!p) return 0
  const css = getComputedStyle(p)
  return parseFloat(axisOf(el) === "x" ? css.columnGap : css.rowGap) || 0
}

/** `el` from its size to nothing (`out`), or back: clipped along the way it moves (a tab's line under it still shows),
 *  and kept at its end till it's taken away (`cancel` puts it back as it was). */
function squeeze(el: HTMLElement, out: boolean): Animation {
  const r = el.getBoundingClientRect(), gap = gapOf(el), x = axisOf(el) === "x"
  const full = x ? { minWidth: `${r.width}px`, maxWidth: `${r.width}px`, marginRight: "0px", opacity: 1 } : { height: `${r.height}px`, marginBottom: "0px", opacity: 1 }
  const none = x ? { minWidth: "0px", maxWidth: "0px", marginRight: `${-gap}px`, opacity: 0 } : { height: "0px", marginBottom: `${-gap}px`, opacity: 0 }
  el.style.clipPath = x ? "inset(-4px 0)" : "inset(0 -8px)"
  // (going, straight out; coming, with the spring: nothing that leaves bounces)
  const a = el.animate(out ? [full, none] : [none, full], { ...timing(out ? "base" : "spring"), fill: out ? "forwards" : "none" })
  const done = () => { el.style.clipPath = "" }
  a.addEventListener("cancel", done)
  if (!out) a.addEventListener("finish", done)
  return a
}

// ---------- folding ----------

const folding = new Set<string>()
/** Tab groups opened by a click, and when: their tabs grow in as they're drawn. */
const opened = new Map<string, number>()

/** Fold or open a tab group as the user does it (its chip or row clicked): its tabs shrink into it, then it folds. */
export function foldSetMoving(id: string) {
  const where = setById(id)
  if (!where || folding.has(id)) return
  if (where.s.collapsed) { opened.set(id, performance.now()); foldSet(id, false); return }
  const els = [...document.querySelectorAll<HTMLElement>(`[data-in-set="${id}"]`)].filter((e) => e.offsetParent !== null)
  if (still() || !els.length) { foldSet(id, true); return }
  folding.add(id)
  // (its chevron turns and its line goes as it starts, not when it's done)
  for (const h of document.querySelectorAll(`[data-set-chip="${id}"], [data-set-row="${id}"]`)) h.setAttribute("aria-expanded", "false")
  const lines = [...document.querySelectorAll<HTMLElement>(`[data-set-line="${id}"]`)]
  const moving = [...els.map((e) => squeeze(e, true)), ...lines.map((l) => l.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing("base"), fill: "forwards" }))]
  Promise.allSettled(moving.map((a) => a.finished)).then(() => {
    folding.delete(id)
    foldSet(id, true)
    // (once React has taken them away; a tab that stays, the one on screen moved out, is put back)
    requestAnimationFrame(() => moving.forEach((a) => a.cancel()))
  })
}

// ---------- tabs coming and going ----------

/** Tabs that came into the workspace just now, and when: opened one or two at a time, not a whole layout put in place
 *  (another workspace, another device's change). */
const born = new Map<string, number>()
let known = new Set<string>()
const ids = () => new Set(groups().flatMap((g) => g.tabs.map((t) => t.id)))
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

/** A tab's element grows in as it's drawn: a new tab, or one of a group just opened. */
export function useGrowIn(ref: RefObject<HTMLElement | null>, tab: { id: string; set?: string }) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || still() || !(recent(born.get(tab.id)) || (tab.set && recent(opened.get(tab.set))))) return
    born.delete(tab.id)
    const a = squeeze(el, false)
    return () => a.cancel()
  }, [])  // (on its first drawing only)
}

/** A tab bar's tab that goes (closed, or moved to another pane) shrinks away where it was, however it went (its X, a
 *  shortcut, Close others): a copy of it, as React takes it out, so the tabs after it slide over instead of jumping. */
export function useShrinkOut(ref: RefObject<HTMLElement | null>, id: string, group: string) {
  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      // (still in its group: drawn again elsewhere in the bar, as into a tab group; or folded away, already shrunk)
      if (!el?.isConnected || still() || replacingWorkspace() || groupOfTab(id)?.id === group) return
      const w = el.getBoundingClientRect().width
      if (w < 1) return
      const copy = el.cloneNode(true) as HTMLElement
      for (const a of ["data-tab-id", "data-slide", "data-select-key", "data-in-set", "data-selected"]) copy.removeAttribute(a)
      copy.querySelector("[data-tab-return]")?.remove()
      copy.inert = true
      // (its own width while it's beside the original, gone once React has taken that out)
      Object.assign(copy.style, { pointerEvents: "none", flex: `0 0 ${w}px` })
      el.after(copy)
      squeeze(copy, true).finished.then(() => copy.remove(), () => copy.remove())
    }
  }, [ref, id, group])
}

/** Close a tab from a list of them (the Tabs panel): its row shrinks away, then it closes. */
export function closeTabMoving(id: string, el: HTMLElement | null) {
  if (!el || still()) { closeTab(id); return }
  const a = squeeze(el, true)
  el.style.pointerEvents = "none"
  a.addEventListener("cancel", () => { el.style.pointerEvents = "" })
  a.finished.then(() => { closeTab(id); requestAnimationFrame(() => a.cancel()) }, () => {})
}
