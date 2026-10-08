// Something heavy (a map: a WebGL context) is made once it comes near the screen, so a long dashboard or a hidden tab
// doesn't make every one. Once made, it stays.
import { useEffect, useState, type RefObject } from "react"

/** Whether `ref`'s element has come within `margin` of the screen (of what scrolls it); stays true after. */
export function useNearScreen(ref: RefObject<Element | null>, margin = "600px"): boolean {
  // (without IntersectionObserver: at once)
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined")
  useEffect(() => {
    const el = ref.current
    if (near || !el) return
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); o.disconnect() } }, { rootMargin: margin })
    o.observe(el)
    return () => o.disconnect()
  }, [ref, near, margin])
  return near
}
