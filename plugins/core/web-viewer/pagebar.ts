// The page bar hidden (setting `pageBar`, as Zen's compact mode): the page fills its tab; the bar slides over it while
// the pointer's at the page's top, the pane's top or the bar, on a click at those tops, the keyboard in it, a new tab.
import { useEffect, useState, type RefObject } from "react"
import { PanelTopClose, PanelTopOpen } from "lucide-react"
import { useBarsHidden, type MenuItem, type WebPages } from "@vaultite"
import { settings } from "./state"

/** How long the pointer rests at the page's top or the pane's before the bar comes (a quick pass doesn't bring it), and
 *  how long it's been off the bar before it goes. */
const REST_MS = 60, LINGER_MS = 350

export const barHidden = () => settings.get().pageBar === "hidden"
export const setBarHidden = (hidden: boolean) => settings.set({ pageBar: hidden ? "hidden" : null })

/** Hide page bar, or Always show page bar: the bar's menus, the pane's top's and the palette's. */
export const pageBarItem = (sep = false): MenuItem => (barHidden()
  ? { label: "Always show page bar", icon: PanelTopOpen, sep, run: () => void setBarHidden(false) }
  : { label: "Hide page bar", icon: PanelTopClose, sep, run: () => void setBarHidden(true) })

/** Whether the bar is hidden (setting), and whether it's out now (always, when it isn't hidden; `keep`: kept out).
 *  `group`: its pane, whose top (Tabs.tsx's `data-tabs-hidden` bar: a strip, or the title) brings it too. */
export function usePageBar(web: WebPages, id: number, group: string | undefined, bar: RefObject<HTMLElement | null>, keep: boolean) {
  // (a pop-out with its bars hidden: hidden too, and only the keyboard brings it, ⌘L; the pointer at its top is the
  // window's, to move it)
  const bare = useBarsHidden()
  const hidden = settings.use().pageBar === "hidden" || bare
  const [pointer, setPointer] = useState(false)
  const [typing, setTyping] = useState(false)

  // Coming: the desktop app tells when the pointer is at the page's top (the window hears nothing over a page), and
  // the window hears it on the pane's top. A click on either brings it at once.
  useEffect(() => {
    if (!hidden || bare) return
    let t = 0
    const come = (now: boolean) => {
      if (now) { clearTimeout(t); t = 0; setPointer(true) }
      else if (!t) t = window.setTimeout(() => { t = 0; setPointer(true) }, REST_MS)
    }
    const stay = () => { clearTimeout(t); t = 0 }
    const off = id ? web.on((m) => { if (m.type === "top" && m.id === id) { if (m.at) come(!!m.now); else stay() } }) : () => {}
    const top = (e: Event) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-pane-bar]") : null
      return !!el && !!group && el.dataset.paneBar === group
    }
    const over = (e: PointerEvent) => { if (top(e)) come(false); else stay() }
    // (its own buttons, the pane's handle and X, do what they do)
    const down = (e: PointerEvent) => { if (e.button === 0 && top(e) && !(e.target as Element).closest("button")) come(true) }
    addEventListener("pointerover", over, { passive: true })
    addEventListener("pointerdown", down, true)
    return () => { stay(); off(); removeEventListener("pointerover", over); removeEventListener("pointerdown", down, true) }
  }, [hidden, bare, id, group, web])

  // Out, the bar covers the page's top and the window is over the page, so it hears the pointer everywhere: it goes once
  // the pointer has been off it, the pane's top and its menus a moment, and at once on a click elsewhere.
  useEffect(() => {
    if (!pointer) return
    let t = 0
    const onIt = (e: Event) => {
      const el = e.target instanceof Element ? e.target : null
      if (!el) return false
      const top = el.closest<HTMLElement>("[data-pane-bar]")
      return !!bar.current?.contains(el) || !!el.closest("[role=menu]") || (!!top && top.dataset.paneBar === group)
    }
    const move = (e: PointerEvent) => {
      if (onIt(e)) { clearTimeout(t); t = 0; return }
      if (!t) t = window.setTimeout(() => { t = 0; if (!document.querySelector("[role=menu]")) setPointer(false) }, LINGER_MS)
    }
    const down = (e: PointerEvent) => { if (!onIt(e)) setPointer(false) }
    addEventListener("pointermove", move, { passive: true })
    addEventListener("pointerdown", down, true)
    return () => { clearTimeout(t); removeEventListener("pointermove", move); removeEventListener("pointerdown", down, true) }
  }, [pointer, bar, group])

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
