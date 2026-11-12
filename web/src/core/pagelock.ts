// A touch guard holds the page, not a fixed body: under a fixed body WebKit hit-tests overlays' scrollers in the wrong place.
import { useLayoutEffect } from "react"
import { keyboardUp } from "@/components/KeyBar"

function trackViewport() {
  const vv = visualViewport
  if (!vv) return () => {}
  const st = document.documentElement.style
  // A custom property changed on the root restyles every element: set only while the visual viewport differs.
  let set = false
  const put = () => {
    const differs = Math.abs(vv.height - innerHeight) > 1 || Math.abs(vv.offsetTop) > 1
    if (differs) { st.setProperty("--vvh", `${vv.height}px`); st.setProperty("--vvtop", `${vv.offsetTop}px`) }
    else if (set) { st.removeProperty("--vvh"); st.removeProperty("--vvtop") }
    set = differs
  }
  put()
  vv.addEventListener("resize", put)
  vv.addEventListener("scroll", put)
  return () => {
    vv.removeEventListener("resize", put); vv.removeEventListener("scroll", put)
    if (set) { st.removeProperty("--vvh"); st.removeProperty("--vvtop") }
  }
}

// At a scroller's end iOS pans the screen while the keyboard is up, so the end counts only with the keyboard down.
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
    if (el.closest?.("input, textarea, [contenteditable=true]") || getComputedStyle(el).touchAction === "none") return
    const axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x"
    if (!scrollerFor(el, axis, axis === "y" ? -dy : -dx)) e.preventDefault()
  }
  document.addEventListener("touchstart", start, { passive: true })
  document.addEventListener("touchmove", move, { passive: false })
  return () => { document.removeEventListener("touchstart", start); document.removeEventListener("touchmove", move) }
}

let held = 0
let restore: (() => void) | null = null
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

// iOS often moves the screen on a list's first drag with the keyboard up: the field gives up the keyboard and the list
// follows the finger itself.
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

export function relockScroll() {
  if (held) heldAt = scrollY
}

export function lockPage() {
  if (held++ === 0) restore = hold()
  let done = false
  return () => {
    if (done) return
    done = true
    if (--held === 0) { restore?.(); restore = null }
  }
}

export function usePageLock(on = true) {
  useLayoutEffect(() => (on ? lockPage() : undefined), [on])
}
