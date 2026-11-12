import { useEffect } from "react"
import { CircleAlert } from "lucide-react"
import { Toaster as Sonner } from "sonner"
import { byTab } from "@/core/focus"
import { toasterDrawn } from "@/core/notify"

// Tabbing out of a toast, sonner gives the keyboard back to where it came from (the Tab undone): not when the user
// sent it somewhere (or past the page's end).
if (typeof window !== "undefined") {
  addEventListener("focusout", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-sonner-toaster]")) return
    const to = e.relatedTarget
    if (to instanceof Element ? !to.closest("[data-sonner-toaster]") : byTab(e)) e.stopPropagation()
  }, true)
  addEventListener("focusin", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-sonner-toaster]") || byTab(e)) return
    if (!e.target.matches("[data-sonner-toaster]")) return e.stopPropagation()
    const front = e.target.querySelector<HTMLElement>("[data-front=true]")
    const to = front?.querySelector<HTMLElement>("[data-button]") ?? front
    to?.focus()
  }, true)
}

// Toasts are read from core/announce.ts's live region (an error at once): sonner's own, polite for all, would say each
// twice. React sets the attribute once, so it stays off.
const quiet = (el: HTMLElement | null) => { el?.setAttribute("aria-live", "off") }

export function Toaster({ desktop }: { desktop: boolean }) {
  const phone = { bottom: "calc(var(--phone-bar) + var(--mini-player) + var(--trial-bar) + 0.75rem)", left: 16, right: 16 }
  useEffect(toasterDrawn, []) // (after sonner's own: it listens from then)
  return (
    <Sonner position={desktop ? "bottom-right" : "bottom-center"} visibleToasts={3} gap={8} duration={4000}
      offset={desktop ? { bottom: "calc(40px + env(safe-area-inset-bottom) + var(--corner-cards) + var(--trial-bar))", right: "calc(16px + env(safe-area-inset-right))" } : phone} mobileOffset={phone} className="vau-toaster"
      icons={{ error: <CircleAlert className="size-4 text-[var(--red)]" strokeWidth={2.25} /> }}
      toastOptions={{ className: "vau-toast" }} containerAriaLabel="Notifications" ref={quiet} />
  )
}
