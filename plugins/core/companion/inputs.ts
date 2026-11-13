import { interfaceZoom } from "./locate.ts"

type Send = (m: object) => boolean
let off: (() => void) | null = null
function named(e: Element | null) {
  const el = e?.closest<HTMLElement>("button, a, [role], [aria-label], [data-tip], [data-ui], input, textarea, select, label")
  if (!el) return null
  const label = el.getAttribute("aria-label") || el.dataset.tip || (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder : "") || el.textContent?.trim().replace(/\s+/g, " ").slice(0, 120) || ""
  return { label, role: el.getAttribute("role") || el.tagName.toLowerCase(), ...(el.dataset.ui ? { ui: el.dataset.ui } : {}) }
}
export function listenInputs(on: boolean, send: Send) {
  off?.()
  off = null
  if (!on) return
  let typed = 0
  const down = (e: PointerEvent) => {
    const z = interfaceZoom(), x = Math.round(window.screenX + e.clientX * z), y = Math.round(window.screenY + Math.max(0, window.outerHeight - window.innerHeight * z) + e.clientY * z)
    send({ t: "input", kind: "click", x, y, ...(named(e.target instanceof Element ? e.target : null) ?? {}) })
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") return void send({ t: "input", kind: "esc" })
    if (Date.now() - typed < 300 || e.metaKey || e.ctrlKey) return
    typed = Date.now()
    send({ t: "input", kind: "type", ...(named(document.activeElement) ?? {}) })
  }
  document.addEventListener("pointerdown", down, true)
  document.addEventListener("keydown", key, true)
  off = () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true) }
}
