import { useEffect, useMemo, useState } from "react"
import type { CanvasDoc } from "./codec"
import { fitView, type View } from "./geometry"
import { typing } from "./keys"
import { slidesOf } from "./present"

export function usePresenting(doc: CanvasDoc, size: () => { w: number; h: number }, animateTo: (to: View) => void, fitAll: () => void) {
  const slides = useMemo(() => slidesOf(doc), [doc])
  const [slide, setSlide] = useState<number | null>(null)
  const showSlide = (i: number) => {
    const g = slides[Math.max(0, Math.min(slides.length - 1, i))]
    if (!g) return setSlide(null)
    setSlide(slides.indexOf(g))
    const { w, h } = size()
    animateTo(fitView([g], w, h, 40, 4))
  }
  const endPresenting = () => { setSlide(null); fitAll() }
  useEffect(() => {
    if (slide === null) return
    const key = (e: globalThis.KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const go = ["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key) ? 1 : ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) ? -1 : 0
      if (!go && e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") endPresenting(); else showSlide(slide + go)
    }
    window.addEventListener("keydown", key, true)
    return () => window.removeEventListener("keydown", key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, slides])
  return { slides, slide, showSlide, endPresenting }
}
