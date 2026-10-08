// The page held still under overlays (counted, since they stack), by a touch guard rather than a fixed body: on iOS a
// fixed body made WebKit hit-test overlays' scrollers in the wrong place. `--vvh`/`--vvtop` let overlays end above the keyboard.
import { useLayoutEffect } from "react"

/** Whether the keyboard (or anything else) covers part of the screen: the visual viewport is shorter than the page's. */
const keyboardUp = () => !!visualViewport && innerHeight - visualViewport.height > 80

function trackViewport() {
  const vv = visualViewport
  if (!vv) return () => {}
  const st = document.documentElement.style
  const put = () => { st.setProperty("--vvh", `${vv.height}px`); st.setProperty("--vvtop", `${vv.offsetTop}px`) }
  put()
  vv.addEventListener("resize", put)
  vv.addEventListener("scroll", put)
  return () => {
    vv.removeEventListener("resize", put); vv.removeEventListener("scroll", put)
    st.removeProperty("--vvh"); st.removeProperty("--vvtop")
  }
}

/** The element from `el` up that scrolls along `axis` and can still move that way (`d` < 0: towards its start); at its
 *  end it doesn't count while the keyboard is up (iOS would pan the screen instead), else it does (its own bounce). */
function scrollerFor(el: Element | null, axis: "x" | "y", d: number): boolean {
  const kb = keyboardUp()
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n), o = axis === "y" ? cs.overflowY : cs.overflowX
    if (o !== "auto" && o !== "scroll") continue
    const size = axis === "y" ? n.scrollHeight - n.clientHeight : n.scrollWidth - n.clientWidth
    if (size < 1) continue
    if (!kb) return true
    const at = axis === "y" ? n.scrollTop : Math.abs(n.scrollLeft)
    if (d < 0 ? at > 0 : at < size - 1) return true
  }
  return false
}

function guard() {
  let x = 0, y = 0, decided = false
  const start = (e: TouchEvent) => { x = e.touches[0]?.clientX ?? 0; y = e.touches[0]?.clientY ?? 0; decided = false }
  const move = (e: TouchEvent) => {
    if (decided || e.touches.length !== 1 || !e.cancelable) return
    const t = e.touches[0], dx = t.clientX - x, dy = t.clientY - y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) return
    decided = true
    const el = e.target as Element
    // What handles its own touches (a slider, a map, a drawing) and text being typed in (its caret's loupe) are left alone.
    if (el.closest?.("input, textarea, [contenteditable=true]") || getComputedStyle(el).touchAction === "none") return
    const axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x"
    // A finger moving up scrolls towards the end.
    if (!scrollerFor(el, axis, axis === "y" ? -dy : -dx)) e.preventDefault()
  }
  document.addEventListener("touchstart", start, { passive: true })
  document.addEventListener("touchmove", move, { passive: false })
  return () => { document.removeEventListener("touchstart", start); document.removeEventListener("touchmove", move) }
}

let held = 0
let restore: (() => void) | null = null
/** Where the page was scrolled when it was held: put back on release. */
let heldAt = 0

function hold() {
  const html = document.documentElement, body = document.body
  heldAt = scrollY
  const gap = innerWidth - html.clientWidth
  const style = body.getAttribute("style")
  html.style.overflow = "hidden"
  Object.assign(body.style, { overflow: "hidden", paddingRight: gap > 0 ? `${gap}px` : "" })
  const untrack = trackViewport(), unguard = guard()
  return () => {
    untrack(); unguard()
    if (style === null) body.removeAttribute("style"); else body.setAttribute("style", style)
    html.style.overflow = ""
    if (scrollY !== heldAt) scrollTo(0, heldAt)
  }
}

/** A list whose first drag with the keyboard up is its own (iOS often moves the screen instead): the screen stays, the
 *  field gives up the keyboard and the list follows the finger itself. Returns the undo. */
export function dismissKeyboardOnDrag(list: HTMLElement) {
  let y = 0, mine = false, v = 0, t = 0, glide = 0
  const start = (e: TouchEvent) => { cancelAnimationFrame(glide); y = e.touches[0]?.clientY ?? 0; mine = false; v = 0; t = e.timeStamp }
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 1 || !e.cancelable) return
    const ny = e.touches[0].clientY
    if (!mine) {
      const field = document.activeElement
      if (Math.abs(ny - y) < 3 || !keyboardUp() || !(field instanceof HTMLElement) || !field.matches("input, textarea")) return
      mine = true
      field.blur()
    }
    e.preventDefault()
    const dt = Math.max(1, e.timeStamp - t)
    v = (y - ny) / dt
    list.scrollTop += y - ny
    y = ny; t = e.timeStamp
  }
  const end = () => {
    if (!mine) return
    mine = false
    // A flick glides on, slowing as a list does.
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      v *= Math.pow(0.995, dt)
      if (Math.abs(v) < 0.02) return
      list.scrollTop += v * dt
      glide = requestAnimationFrame(step)
    }
    if (Math.abs(v) > 0.1) glide = requestAnimationFrame(step)
  }
  list.addEventListener("touchstart", start, { passive: true })
  list.addEventListener("touchmove", move, { passive: false })
  list.addEventListener("touchend", end)
  list.addEventListener("touchcancel", end)
  return () => {
    cancelAnimationFrame(glide)
    list.removeEventListener("touchstart", start); list.removeEventListener("touchmove", move)
    list.removeEventListener("touchend", end); list.removeEventListener("touchcancel", end)
  }
}

/** The page under the overlays was changed for another (a tab picked in the tab list, shown under it): it keeps its
 *  own place on release, not the one before. */
export function relockScroll() {
  if (held) heldAt = scrollY
}

/** Hold the page; returns the release (the page moves again once every hold is released). */
export function lockPage() {
  if (held++ === 0) restore = hold()
  let done = false
  return () => {
    if (done) return
    done = true
    if (--held === 0) { restore?.(); restore = null }
  }
}

/** Hold the page while `on`. Before the component's own layout effects that come after it (a field it focuses). */
export function usePageLock(on = true) {
  useLayoutEffect(() => (on ? lockPage() : undefined), [on])
}
