// Which pane a view is in: the focused one gets the status bar and keyboard commands; outside panes a view counts as
// focused. `hidden`: a tab kept drawn behind another, never focused; `tab`: the tab's id.
import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type RefObject } from "react"

export const PaneContext = createContext<{ group: string; focused: boolean; hidden?: boolean; tab?: string }>({ group: "", focused: true })
export const usePane = () => useContext(PaneContext)

/** The panes whose shown tab draws a top bar, each with how many. */
const barred = new Map<string, number>()
const subs = new Set<() => void>()
const changed = () => { for (const f of subs) f() }
/** Whether the pane's shown tab draws a top bar (usePaneTopBar): without a tab bar, it's the pane's title row. */
export const usePaneHasTopBar = (group: string) =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => barred.has(group))

/** How far a top bar keeps from what's fixed over the window's corners. */
const CLEAR = 8

/** A view's top bar (ViewBar, the Browser's): without a tab bar it's its pane's title row (Tabs.tsx), and it makes room
 *  for what's fixed over the window's corners (the sidebars' toggles, a Mac's traffic lights). */
export function usePaneTopBar(ref: RefObject<HTMLElement | null>) {
  const { group, hidden } = usePane()
  // (before the paint, so the tab bar takes its place in the same frame)
  useLayoutEffect(() => {
    if (!group || hidden || !ref.current) return
    barred.set(group, (barred.get(group) ?? 0) + 1)
    changed()
    return () => {
      const n = (barred.get(group) ?? 1) - 1
      if (n) barred.set(group, n); else barred.delete(group)
      changed()
    }
  }, [ref, group, hidden])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || hidden) return
    let frame = 0
    const fit = () => {
      el.style.paddingLeft = el.style.paddingRight = ""
      const b = el.getBoundingClientRect()
      if (!b.width) return
      const cs = getComputedStyle(el), padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight)
      let left = 0, right = 0
      for (const o of overCorners()) {
        if (o.bottom <= b.top || o.top >= b.bottom || o.right <= b.left || o.left >= b.right) continue
        if (o.left + o.right < b.left + b.right) left = Math.max(left, o.right + CLEAR - b.left - padL)
        else right = Math.max(right, b.right - padR - o.left + CLEAR)
      }
      if (left > 0) el.style.paddingLeft = `${padL + left}px`
      if (right > 0) el.style.paddingRight = `${padR + right}px`
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
  // (index.css: the lights take the window's first 88px; electron/main.ts: they're 16px tall, 14 down at most)
  if ("electron" in d && d.platform === "darwin" && !("fullscreen" in d) && ("leftRail" in d || "popout" in d)) out.push(new DOMRect(0, 0, 88 - CLEAR, 30))
  // (Windows' controls: the window's top-right corner, as wide as electron/preload.cjs says, a title row high)
  if ("electron" in d && d.platform === "win32" && !("fullscreen" in d)) {
    const w = parseFloat(document.documentElement.style.getPropertyValue("--window-controls")) || 138
    out.push(new DOMRect(innerWidth - w + CLEAR, 0, w - CLEAR, 30))
  }
  return out
}
