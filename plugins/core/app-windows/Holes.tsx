// Each shown app tab (`data-app-hole`) whose window is in place (`data-app-placed`) cut out of the page's background and of #root's child holding it, so the app
// behind shows and the rest (sidebars, palette, sheets) draws over it; the pointer over it goes through (`through`).
import { useEffect } from "react"
import { appWindows } from "@vaultite"

const CSS = `html[data-app-holes], html[data-app-holes] body { background: transparent !important }
html[data-app-holes] body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: var(--background); clip-path: var(--app-holes) }`

/** The desktop app ended letting the pointer through (it watches the cursor too): passed again over a hole. */
let ended = () => {}
export const throughEnded = () => ended()

export function Holes() {
  useEffect(() => {
    const api = appWindows
    const root = document.getElementById("root")
    if (!api || !root) return
    const html = document.documentElement
    const style = document.createElement("style")
    style.textContent = CSS
    document.head.append(style)
    let holes: DOMRect[] = [], raf = 0, through = false, clipped = ""
    /** The parts of the page cut, with their clip paths. */
    let cutParts = new Map<HTMLElement, string>()
    const path = (rs: DOMRect[], at: DOMRect) => {
      const w = Math.max(at.width, innerWidth), h = Math.max(at.height, innerHeight)
      return `path(evenodd, "M0 0H${w}V${h}H0Z${rs.map((r) => `M${r.left - at.left} ${r.top - at.top}h${r.width}v${r.height}h${-r.width}Z`).join("")}")`
    }
    const pass = (on: boolean) => { if (on !== through) { through = on; void api.through(on).catch(() => {}) } }
    ended = () => { through = false }
    const cut = () => {
      raf = 0
      const shown = [...document.querySelectorAll<HTMLElement>("[data-app-hole][data-app-placed]")]
        .map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width >= 2 && r.height >= 2)
      holes = shown.map((x) => x.r)
      // (only what changed: setting a style is a mutation the observer hears)
      const parts = new Map<HTMLElement, DOMRect[]>()
      for (const { e, r } of shown) {
        let part = e
        while (part.parentElement && part.parentElement !== root) part = part.parentElement
        if (part.parentElement === root) parts.set(part, [...(parts.get(part) ?? []), r])
      }
      const next = new Map<HTMLElement, string>()
      for (const [part, rs] of parts) {
        const clip = path(rs, part.getBoundingClientRect())
        next.set(part, clip)
        if (cutParts.get(part) !== clip) part.style.clipPath = clip
      }
      for (const part of cutParts.keys()) if (!next.has(part)) part.style.clipPath = ""
      cutParts = next
      const clip = holes.length ? path(holes, new DOMRect(0, 0, innerWidth, innerHeight)) : ""
      if (clip !== clipped) {
        clipped = clip
        if (clip) { html.dataset.appHoles = ""; html.style.setProperty("--app-holes", clip) }
        else { delete html.dataset.appHoles; html.style.removeProperty("--app-holes") }
      }
      if (!holes.length) pass(false)
    }
    const soon = () => { if (!raf) raf = requestAnimationFrame(cut) }
    // (forwarded while the window lets the pointer through, so it's heard coming back out of a hole too)
    const move = (e: MouseEvent) => {
      const over = holes.some((r) => e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom)
      const at = over ? document.elementFromPoint(e.clientX, e.clientY) : null
      pass(over && (!at || at === html || at === document.body || at === root))
    }
    const mo = new MutationObserver(soon)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-app-hole", "data-app-placed", "data-state", "open"] })
    addEventListener("resize", soon)
    addEventListener("mousemove", move, { capture: true, passive: true })
    const tick = setInterval(soon, 500)
    cut()
    return () => {
      mo.disconnect()
      removeEventListener("resize", soon)
      removeEventListener("mousemove", move, { capture: true })
      clearInterval(tick)
      cancelAnimationFrame(raf)
      delete html.dataset.appHoles
      html.style.removeProperty("--app-holes")
      for (const part of cutParts.keys()) part.style.clipPath = ""
      style.remove()
      pass(false)
      ended = () => {}
    }
  }, [])
  return null
}
