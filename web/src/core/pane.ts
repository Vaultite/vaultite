import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type RefObject } from "react"

export const PaneContext = createContext<{ pane: string; tab: string; focused: boolean; hidden?: boolean }>({ pane: "", tab: "", focused: true })
export const usePane = () => useContext(PaneContext)

const barred = new Map<string, number>()
const subs = new Set<() => void>()
const changed = () => { for (const f of subs) f() }
export const usePaneHasTopBar = (pane: string) =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => barred.has(pane))

const CLEAR = 8

/** A view's top bar (ViewBar, the Browser's): without a pane tab bar its pane's title row (Tabs.tsx; not with `title` false,
 *  one sliding over the view), clear of what's fixed over the window's corners (sidebar toggles, a Mac's lights). */
export function usePaneTopBar(ref: RefObject<HTMLElement | null>, title = true) {
  const { pane, hidden } = usePane()
  useLayoutEffect(() => {
    if (!pane || hidden || !ref.current || !title) return
    barred.set(pane, (barred.get(pane) ?? 0) + 1)
    changed()
    return () => {
      const n = (barred.get(pane) ?? 1) - 1
      if (n) barred.set(pane, n); else barred.delete(pane)
      changed()
    }
  }, [ref, pane, hidden, title])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || hidden) return
    let frame = 0, added = [0, 0]
    const fit = () => {
      const b = el.getBoundingClientRect()
      if (!b.width) return
      const cs = getComputedStyle(el), padL = parseFloat(cs.paddingLeft) - added[0], padR = parseFloat(cs.paddingRight) - added[1]
      let left = 0, right = 0
      for (const o of overCorners()) {
        if (o.bottom <= b.top || o.top >= b.bottom || o.right <= b.left || o.left >= b.right) continue
        if (o.left + o.right < b.left + b.right) left = Math.max(left, o.right + CLEAR - b.left - padL)
        else right = Math.max(right, b.right - padR - o.left + CLEAR)
      }
      const next = [Math.round(Math.max(0, left) * 10) / 10, Math.round(Math.max(0, right) * 10) / 10]
      if (next[0] !== added[0]) el.style.paddingLeft = next[0] ? `${padL + next[0]}px` : ""
      if (next[1] !== added[1]) el.style.paddingRight = next[1] ? `${padR + next[1]}px` : ""
      added = next
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fit() }) }
    fit()
    const ro = new ResizeObserver(soon), mo = new MutationObserver(soon)
    ro.observe(el)
    mo.observe(document.documentElement, { attributes: true })
    addEventListener("resize", soon)
    return () => { cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect(); removeEventListener("resize", soon); el.style.paddingLeft = el.style.paddingRight = "" }
  }, [ref, hidden])
}

// 88: where the traffic lights end (index.css' 88px); 138: Windows' controls (electron/main.ts CONTROLS_WIDTH).
function overCorners(): DOMRect[] {
  const d = document.documentElement.dataset
  const out: DOMRect[] = []
  if (!("noRails" in d)) for (const t of document.querySelectorAll("[data-sidebar-toggle]")) out.push(t.getBoundingClientRect())
  if (lightsOverPanes(d)) {
    const card = lightsCard() ?? { x: 0, y: 0 }
    out.push(new DOMRect(card.x, 0, 88 - CLEAR, 30 + card.y))
  }
  if ("electron" in d && d.platform === "win32" && !("fullscreen" in d)) {
    const w = parseFloat(document.documentElement.style.getPropertyValue("--window-controls")) || 138
    out.push(new DOMRect(innerWidth - w + CLEAR, 0, w - CLEAR, 30))
  }
  return out
}

const lightsOverPanes = (d: DOMStringMap) =>
  "electron" in d && d.platform === "darwin" && !("fullscreen" in d) && ("leftRail" in d || ("popout" in d && !("barsHidden" in d)))

export function lightsCard(): { x: number; y: number } | null {
  const d = document.documentElement.dataset, area = document.querySelector("[data-pane-area]")
  if (!area || !("paneCards" in d) || "topTabs" in d) return null
  const a = area.getBoundingClientRect(), gap = parseFloat(getComputedStyle(area).getPropertyValue("--pane-gap")) || 0
  return { x: a.left + gap, y: a.top + gap }
}
