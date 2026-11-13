import { useCallback } from "react"
import { cn, NoteBody, type Store } from "@vaultite"
import type { Box } from "./slides"

const tones = new Map<string, "light" | "dark" | null>()
export function toneOf(color: string) {
  if (tones.has(color)) return tones.get(color)!
  let tone: "light" | "dark" | null = null
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (c && CSS.supports("color", color)) {
    c.fillStyle = color
    c.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data
    const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    if (a >= 128) tone = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.18 ? "dark" : "light"
  }
  tones.set(color, tone)
  return tone
}
export const toneClass = (bg: string) => { const t = toneOf(bg); return t ? `text-foreground ${t === "dark" ? "dark" : "scheme-preview"}` : "" }

const ANIMATIONS: Record<string, string> = {
  fadeIn: "", slideRightIn: "translate3d(-200px, 0, 0)", slideLeftIn: "translate3d(200px, 0, 0)", slideUpIn: "translate3d(0, 150px, 0)",
  slideDownIn: "translate3d(0, -150px, 0)", scaleUp: "scale(.78)", scaleDown: "scale(1.23)", fadeOut: "", slideRightOut: "translate3d(200px, 0, 0)",
  slideLeftOut: "translate3d(-200px, 0, 0)", slideUpOut: "translate3d(0, -150px, 0)", slideDownOut: "translate3d(0, 150px, 0)", scaleUpOut: "scale(1.23)", scaleDownOut: "scale(.78)",
}
export const LAYOUT_CSS = `
[data-slide-box] > .note-body, [data-slide-box] > .note-body > .note-body-md { display: contents; }
[data-slide-box] > .note-body > .note-body-md > :last-child { margin-bottom: 0; }
[data-slide-box=split] { width: 100%; box-sizing: border-box; }
[data-slide-box=block]:not(:last-child) { margin-bottom: 1em; }
[data-slide-box]:is(.stretch-column, .stretch-row) :is(img, video, iframe) { width: 100%; height: 100%; max-width: 100%; max-height: 100%; object-fit: cover; }
${Object.entries(ANIMATIONS).map(([name, t]) => `@keyframes slides-${name} { ${/Out$/.test(name) ? "to" : "from"} { opacity: 0;${t ? ` transform: ${t};` : ""} } }
[data-deck] .${name} { animation: slides-${name} var(--slides-animation, .7s) cubic-bezier(.1, .9, .2, 1) both; }`).join("\n")}
[data-deck] .slower { --slides-animation: 1.3s; }
[data-deck] .faster { --slides-animation: .35s; }
@media (prefers-reduced-motion: reduce) { ${Object.keys(ANIMATIONS).map((n) => `[data-deck] .${n}`).join(", ")} { animation-duration: 1ms; } }
`

function* itemsOf(box: Element): Generator<HTMLElement> {
  for (const c of box.children) {
    if (!c.classList.contains("note-body")) { yield c as HTMLElement; continue }
    for (const d of c.children) {
      if (d.classList.contains("note-body-md")) yield* d.children as Iterable<HTMLElement>
      else yield d as HTMLElement
    }
  }
}

export function layOut(root: HTMLElement) {
  for (const b of root.querySelectorAll<HTMLElement>("[data-kids]")) {
    const nth: string[] = JSON.parse(b.dataset.nth || "[]")
    let k = 0
    for (const el of itemsOf(b)) {
      const s = [b.dataset.kids, nth[k++]].filter(Boolean).join("; ")
      if (el.dataset.slideItem !== s) { el.style.cssText += `; ${s}`; el.dataset.slideItem = s }
    }
  }
}

type Ctx = { store: Store; path: string; fm: string }

function BoxView({ box, ctx }: { box: Box; ctx: Ctx }) {
  const bg = box.bg && CSS.supports("color", box.bg) ? box.bg : ""
  const style = [box.style, bg && `background-color: ${bg}`].filter(Boolean).join("; ")
  // A deck's own CSS, which React's style prop would have to parse.
  const ref = useCallback((el: HTMLDivElement | null) => { if (el) el.setAttribute("style", style) }, [style])
  return (
    <div ref={ref} data-slide-box={box.kind} className={cn(box.cls, bg && toneClass(bg)) || undefined} data-fragment-index={box.index}
      data-kids={box.kids || box.nth.length ? box.kids : undefined} data-nth={box.nth.length ? JSON.stringify(box.nth) : undefined}>
      <Boxes items={box.in} ctx={ctx} />
    </div>
  )
}

export function Boxes({ items, ctx }: { items: (Box | string)[]; ctx: Ctx }) {
  return items.map((it, k) => typeof it === "string"
    ? <NoteBody key={k} store={ctx.store} path={ctx.path} body={it} fm={ctx.fm} className="slide-body" />
    : <BoxView key={k} box={it} ctx={ctx} />)
}
