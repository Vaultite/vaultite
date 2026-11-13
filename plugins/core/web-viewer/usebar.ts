import { useEffect, useState, type RefObject } from "react"
import { trace, useBarsHidden, type WebPages } from "@vaultite"
import { barStart, barStep, type BarEvent, type Pressed } from "./barout"
import { settings } from "./state"

const paneTopOf = (el: Element | null) => {
  const top = el?.closest<HTMLElement>("[data-pane-bar], [data-pane-gap]")
  return top ? top.dataset.paneBar ?? top.dataset.paneGap : undefined
}
const elOf = (e: Event) => (e.target instanceof Element ? e.target : null)

export function usePageBar(web: WebPages, id: number, group: string | undefined, bar: RefObject<HTMLElement | null>, keep: boolean) {
  const bare = useBarsHidden()
  const hidden = settings.use().pageBar === "hidden" || bare
  const [pointer, setPointer] = useState(false)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    if (!hidden || bare) return
    let s = barStart, timer = 0
    const send = (e: BarEvent) => {
      const was = s, step = barStep(s, e)
      s = step.to
      if (was.kind !== s.kind) trace("web-page-bar", { id, on: e.type, from: was.kind, to: s.kind })
      for (const fx of step.do) {
        if (fx.do === "show") setPointer(fx.out)
        else {
          clearTimeout(timer)
          timer = fx.do === "wait" ? window.setTimeout(() => { timer = 0; send({ type: "waited", menu: !!document.querySelector("[role=menu]") }) }, fx.ms) : 0
        }
      }
    }
    const atTop = (el: Element | null) => !!group && paneTopOf(el) === group
    const onIt = (el: Element | null) => !!el && (!!bar.current?.contains(el) || !!el.closest("[role=menu]") || atTop(el))
    const off = id ? web.on((m) => {
      if (m.type === "top" && m.id === id) send({ type: "page", at: !!m.at, now: !!m.now, left: !!m.left })
    }) : () => {}
    const over = (e: PointerEvent) => send({ type: "over", paneTop: atTop(elOf(e)) })
    const move = (e: PointerEvent) => send({ type: "move", onIt: onIt(elOf(e)) })
    const down = (e: PointerEvent) => {
      const el = elOf(e)
      const on: Pressed = atTop(el) ? (e.button === 0 && !el?.closest("button") ? "top" : "top-control") : onIt(el) ? "bar" : "elsewhere"
      send({ type: "press", on })
    }
    addEventListener("pointerover", over, { passive: true })
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerdown", down, true)
    return () => {
      clearTimeout(timer)
      setPointer(false)
      off()
      removeEventListener("pointerover", over)
      removeEventListener("pointermove", move)
      removeEventListener("pointerdown", down, true)
    }
  }, [hidden, bare, id, group, web, bar])

  useEffect(() => {
    const el = bar.current
    if (!hidden || !el) return
    const come = () => setTyping(true)
    const go = (e: FocusEvent) => { if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) setTyping(false) }
    el.addEventListener("focusin", come)
    el.addEventListener("focusout", go)
    setTyping(el.contains(document.activeElement))
    return () => { el.removeEventListener("focusin", come); el.removeEventListener("focusout", go) }
  }, [hidden, bar])

  return { hidden, out: !hidden || keep || pointer || typing }
}
