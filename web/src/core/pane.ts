// Which pane a view is in (its id, "" outside the desktop's panes, where a view counts as focused), and its tab's.
// `hidden`: a pane kept drawn while another tab is on screen, never focused.
import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type RefObject } from "react"

export const PaneContext = createContext<{ pane: string; tab: string; focused: boolean; hidden?: boolean }>({ pane: "", tab: "", focused: true })
export const usePane = () => useContext(PaneContext)

/** The panes whose view draws a top bar, each with how many. */
const barred = new Map<string, number>()
const subs = new Set<() => void>()
const changed = () => { for (const f of subs) f() }
/** Whether the pane's view draws a top bar (usePaneTopBar): without pane titles, it's the pane's title row. */
export const usePaneHasTopBar = (pane: string) =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => barred.has(pane))

/** How far a top bar keeps from what's fixed over the window's corners. */
const CLEAR = 8

/** A view's top bar (ViewBar, the Browser's): without pane titles its pane's title row (Tabs.tsx; not with `title` false,
 *  one sliding over the view), clear of what's fixed over the window's corners (sidebar toggles, a Mac's lights). */
export function usePaneTopBar(ref: RefObject<HTMLElement | null>, title = true) {
  const { pane, hidden } = usePane()
  // (before the paint, so the pane's bar takes its place in the same frame)
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
    // (its own padding less what it added, not reset to measure: that restyled it twice per frame of a sidebar's resize)
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
    // (its pane resizing as a sidebar opens or folds, the window, or what's in the corners: <html>'s attributes)
    const ro = new ResizeObserver(soon), mo = new MutationObserver(soon)
    ro.observe(el)
    mo.observe(document.documentElement, { attributes: true })
    addEventListener("resize", soon)
    return () => { cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect(); removeEventListener("resize", soon); el.style.paddingLeft = el.style.paddingRight = "" }
  }, [ref, hidden])
}

/** What's fixed over the panes' top corners: a sidebar's toggle beside its rail or with none open (with rails: without,
 *  they ride the sidebars), a Mac window's traffic lights where no sidebar holds them, and Windows' window controls. */
function overCorners(): DOMRect[] {
  const d = document.documentElement.dataset
  const out: DOMRect[] = []
  if (!("noRails" in d)) for (const t of document.querySelectorAll("[data-sidebar-toggle]")) out.push(t.getBoundingClientRect())
  // (index.css: the lights take the window's first 88px; electron/main.ts: they're 16px tall, 14 down at most. A pop-out
  // with its bars hidden shows them only over its page, with the pointer at its top: electron/topstrip.ts)
  if ("electron" in d && d.platform === "darwin" && !("fullscreen" in d) && ("leftRail" in d || ("popout" in d && !("barsHidden" in d)))) out.push(new DOMRect(0, 0, 88 - CLEAR, 30))
  // (Windows' controls: the window's top-right corner, as wide as electron/preload.cjs says, a title row high)
  if ("electron" in d && d.platform === "win32" && !("fullscreen" in d)) {
    const w = parseFloat(document.documentElement.style.getPropertyValue("--window-controls")) || 138
    out.push(new DOMRect(innerWidth - w + CLEAR, 0, w - CLEAR, 30))
  }
  return out
}
