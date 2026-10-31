// The page bar hidden (setting `pageBar`, as Zen's compact mode): the page fills its tab, and the bar slides over it
// while the pointer is at the page's top edge or on the bar, the keyboard is in it (⌘L), or the tab is new.
import { useEffect, useState, type RefObject } from "react"
import type { WebPages } from "@vaultite"
import { settings } from "./state"

/** How long the pointer rests at the page's top before the bar comes (brushing past it doesn't), and how long it's
 *  been off the bar before it goes. */
const REST_MS = 120, LINGER_MS = 350

export const barHidden = () => settings.get().pageBar === "hidden"
export const setBarHidden = (hidden: boolean) => settings.set({ pageBar: hidden ? "hidden" : null })

/** Whether the bar is hidden (setting), and whether it's out now (always, when it isn't hidden; `keep`: kept out). */
export function usePageBar(web: WebPages, id: number, bar: RefObject<HTMLElement | null>, keep: boolean) {
  const hidden = settings.use().pageBar === "hidden"
  const [pointer, setPointer] = useState(false)
  const [typing, setTyping] = useState(false)

  // The desktop app tells when the pointer is at the page's top (the window hears nothing over a page).
  useEffect(() => {
    if (!hidden || !id) return
    let t = 0
    const off = web.on((m) => {
      if (m.type !== "top" || m.id !== id) return
      clearTimeout(t)
      if (m.at) t = window.setTimeout(() => setPointer(true), REST_MS)
    })
    return () => { clearTimeout(t); off() }
  }, [hidden, id, web])

  // Out, the bar covers the page's top and the window is over the page, so it hears the pointer everywhere: it goes once
  // the pointer has been off it and its menus a moment, and at once on a click elsewhere.
  useEffect(() => {
    if (!pointer) return
    let t = 0
    const onIt = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null
      return !!el && (!!bar.current?.contains(el) || !!el.closest("[role=menu]"))
    }
    const move = (e: PointerEvent) => {
      if (onIt(e)) { clearTimeout(t); t = 0; return }
      if (!t) t = window.setTimeout(() => { t = 0; if (!document.querySelector("[role=menu]")) setPointer(false) }, LINGER_MS)
    }
    const down = (e: PointerEvent) => { if (!onIt(e)) setPointer(false) }
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerdown", down, true)
    return () => { clearTimeout(t); removeEventListener("pointermove", move); removeEventListener("pointerdown", down, true) }
  }, [pointer, bar])

  // The keyboard in it (⌘L, a Tab to it): out till it leaves.
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
