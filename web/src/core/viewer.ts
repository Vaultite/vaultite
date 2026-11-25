import { closestOf } from "@/core/dom"
import { openDetail } from "@/core/nav"
import type { Size } from "@/core/panzoom"

export type Viewed = { name: string; url: string } | { name: string; svg: SVGSVGElement; size: Size }

const kept = new Map<string, Viewed>()
let seq = 0
export const viewed = (id: string) => kept.get(id) ?? null
export const viewedName = (id: string) => kept.get(id)?.name ?? id.slice(id.lastIndexOf("/") + 1)

export function openViewer(what: { path: string } | Viewed) {
  if ("path" in what) return openDetail(`viewer/${encodeURIComponent(what.path)}`)
  const id = `~${++seq}`
  kept.set(id, what)
  for (const k of kept.keys()) if (kept.size > 20) kept.delete(k)
  openDetail(`viewer/${id}`)
}

const fileIn = (src: string) => {
  try {
    const u = new URL(src, document.baseURI)
    return u.origin === location.origin && /\/api\/raw\//.test(u.pathname) ? u.searchParams.get("path") : null
  } catch { return null }
}

export function viewImage(img: HTMLImageElement, name = img.alt) {
  const path = fileIn(img.currentSrc || img.src)
  openViewer(path ? { path } : { name: name || "Image", url: img.currentSrc || img.src })
}
export function viewDiagram(el: Element) {
  const svg = el instanceof SVGSVGElement ? el : el.querySelector("svg.pele") ?? el.querySelector("svg")
  if (!(svg instanceof SVGSVGElement)) return false
  const r = svg.getBoundingClientRect(), box = svg.viewBox.baseVal
  const size = box && box.width && box.height ? { w: box.width, h: box.height } : { w: r.width, h: r.height }
  const copy = svg.cloneNode(true)
  if (!(copy instanceof SVGSVGElement)) return false
  openViewer({ name: "Diagram", svg: copy, size })
  return true
}

export function viewStill(target: EventTarget | null, embed: HTMLElement) {
  const svg = closestOf(target, "svg")
  if (!svg || endsDrag() || closestOf(target, "a, button, [role=button], [role=tree]") || !embed.contains(svg)) return
  const whole = embed.lastElementChild
  if (whole && whole.contains(svg) && whole.textContent === svg.textContent) viewDiagram(svg)
}

const SLOP = 5
let pressed = { x: 0, y: 0 }, dragged = false
if (typeof window !== "undefined") {
  addEventListener("pointerdown", (e) => { pressed = { x: e.clientX, y: e.clientY } }, true)
  addEventListener("pointerup", (e) => { dragged = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > SLOP }, true)
}
export const endsDrag = () => dragged

const ICON = 40

export function viewerClick(target: EventTarget | null, root: HTMLElement) {
  const at = closestOf<HTMLElement>(target, "img, .mermaid-diagram")
  if (!at || !root.contains(at) || endsDrag()) return false
  if (closestOf(target, "a, button, summary, label, [role=button], [role=option], [data-own-clicks]")) return false
  const embed = closestOf(target, "[data-md-embed], .cm-inline-embed")
  if (embed && embed !== root && root.contains(embed)) return false
  if (!(at instanceof HTMLImageElement)) return viewDiagram(at)
  if (at.width <= ICON && at.height <= ICON) return false
  viewImage(at)
  return true
}
